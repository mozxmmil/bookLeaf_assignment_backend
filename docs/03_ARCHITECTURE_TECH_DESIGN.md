# Architecture & Technical Design

## Tech Stack
| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4 | Fast to build, typed, clean UI |
| Backend | Node.js + Express 5 + TypeScript | Long-lived server needed for SSE; clear layering |
| ORM | Prisma 7 (TS engine + @prisma/adapter-pg) | Typed schema, migrations, seed scripts, no native runtime binary |
| Database | PostgreSQL 16 — Docker locally on port **5440**, Neon in production | Relational data (authors → books → tickets) |
| Auth | JWT (Bearer header + httpOnly cookie) + bcrypt | Bearer works cross-domain (Vercel ↔ Render) |
| Validation | Zod (shared schemas) | Same rules front & back |
| Real-time | Server-Sent Events (SSE) | One-way server → client is all we need; simpler than WebSockets |
| AI | Google Gemini Flash (`GEMINI_MODEL` env, default `gemini-2.5-flash`) | Low cost, fast, native JSON mode, generous free tier |
| API Docs | OpenAPI 3 + Swagger UI at `/api/docs` | |
| Deploy | Frontend → Vercel, Backend → Render/Railway, DB → Neon | Vercel serverless can't hold SSE connections |

## High-Level Diagram
```
 ┌──────────────┐  REST + SSE   ┌─────────────────────────────┐    ┌────────────┐
 │  Next.js UI  │ ────────────▶ │ Express API                 │──▶ │ PostgreSQL │
 │ Author/Admin │ ◀──────────── │  routes → controllers       │    └────────────┘
 └──────────────┘               │  → services → repositories  │
                                │  AI service ───────────────▶│──▶ Gemini API
                                │  EventBus (SSE broadcaster) │
                                └─────────────────────────────┘
```

## Folder Structure (monorepo)
```
bookleaf-portal/
├── frontend/                  # Next.js
│   ├── app/(auth)/login
│   ├── app/author/...
│   ├── app/admin/...
│   ├── components/
│   ├── lib/api.ts             # typed fetch wrapper
│   └── hooks/useTicketStream.ts
├── backend/
│   ├── src/
│   │   ├── config/env.ts      # validated env (Zod)
│   │   ├── middleware/        # auth, requireRole, validate, errorHandler
│   │   ├── modules/
│   │   │   ├── auth/          # routes, controller, service
│   │   │   ├── books/
│   │   │   ├── tickets/
│   │   │   └── admin/
│   │   ├── ai/
│   │   │   ├── provider.ts    # LLMProvider interface (swap Gemini/OpenAI)
│   │   │   ├── gemini.ts
│   │   │   ├── prompts/       # classify.ts, draft.ts
│   │   │   ├── knowledgeBase.ts  # KB split into sections by category
│   │   │   └── aiService.ts   # retries, timeout, fallback, caching
│   │   ├── realtime/sse.ts
│   │   ├── utils/AppError.ts
│   │   └── app.ts / server.ts
│   ├── prisma/schema.prisma
│   ├── prisma/seed.ts         # loads bookleaf_sample_data.json
│   └── openapi.yaml
├── docs/
└── README.md
```
Layering rule: routes (HTTP only) → service (business logic) → Prisma. No DB calls in route handlers.

> Implementation note: this was the original plan. The final code is split into two repos: this backend repo and `bookLeaf_assignment_frontend`. See the README for the exact structure. Prisma schema: `prisma/schema.prisma`.

## Database Schema
```prisma
enum Role        { AUTHOR ADMIN }
enum TicketStatus{ OPEN IN_PROGRESS RESOLVED CLOSED }
enum Priority    { CRITICAL HIGH MEDIUM LOW }
enum Category    { ROYALTY_PAYMENTS ISBN_METADATA PRINTING_QUALITY
                   DISTRIBUTION_AVAILABILITY BOOK_STATUS_PRODUCTION GENERAL_INQUIRY }
enum AiStatus    { PENDING DONE FAILED }

model User {
  id           String  @id @default(cuid())
  email        String  @unique
  passwordHash String
  name         String
  role         Role
  author       Author?
  assigned     Ticket[] @relation("Assignee")
}

model Author {            // fields finalised after reading sample JSON
  id       String @id     // keep id from dataset
  userId   String @unique
  user     User   @relation(fields:[userId], references:[id])
  phone    String?
  city     String?
  books    Book[]
  tickets  Ticket[]
}

model Book {
  id              String   @id
  authorId        String
  author          Author   @relation(fields:[authorId], references:[id])
  title           String
  isbn            String?  // null while in production
  genre           String
  publicationDate DateTime?
  status          String   // production stage or "Published & Live"
  mrp             Decimal
  copiesSold      Int      @default(0)
  royaltyEarned   Decimal  @default(0)
  royaltyPaid     Decimal  @default(0)
  // royaltyPending = earned - paid (computed, not stored)
  tickets         Ticket[]
}

model Ticket {
  id               String       @id @default(cuid())
  number           Int          @default(autoincrement()) @unique
  authorId         String
  bookId           String?      // null = General / Account
  subject          String
  description      String
  attachmentName   String?
  status           TicketStatus @default(OPEN)
  category         Category?
  priority         Priority?
  aiCategory       Category?    // original AI value (to measure overrides)
  aiPriority       Priority?
  aiStatus         AiStatus     @default(PENDING)
  aiDraft          String?      // cached draft
  assigneeId       String?
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
  messages         Message[]
  notes            InternalNote[]
  @@index([status, priority, createdAt])
}

model Message      { id String @id @default(cuid()) ticketId String senderId String
                     body String  isAiAssisted Boolean @default(false) createdAt DateTime @default(now()) }
model InternalNote { id String @id @default(cuid()) ticketId String adminId String
                     body String  createdAt DateTime @default(now()) }
```

## Auth & RBAC
- `POST /auth/login` → JWT `{ sub, role, authorId }` in httpOnly cookie
- `authenticate` middleware on every `/api/*` route except login
- `requireRole('ADMIN')` on `/api/admin/*`
- Author queries always scoped: `where: { authorId: req.user.authorId }` → 404 if not theirs

## Real-Time (SSE)
- `GET /api/stream` (authenticated). Server keeps a map `userId → Response[]`
- Events: `ticket.created` (to admins), `ticket.updated`, `message.created` (to ticket's author + admins)
- Heartbeat every 25s; client auto-reconnects (EventSource does this natively)
- Fallback: client polls every 15s if SSE fails

## Error Format
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Subject is required", "details": [...] } }
```
Codes: `VALIDATION_ERROR 400`, `UNAUTHORIZED 401`, `FORBIDDEN 403`, `NOT_FOUND 404`, `CONFLICT 409`, `AI_UNAVAILABLE 503`, `INTERNAL 500`.

## Environment Variables
```
# backend/.env
DATABASE_URL=postgresql://postgres:bookleaf@localhost:5440/bookleaf
JWT_SECRET=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
CLIENT_ORIGIN=http://localhost:3000
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:4000
```
`.env` in `.gitignore`; commit `.env.example` only.
