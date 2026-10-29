# BookLeaf Author Support & Communication Portal

A full-stack support portal for BookLeaf Publishing. Authors raise and track support tickets. The ops team triages and answers them faster with AI-assisted **classification**, **priority scoring** and **draft replies** grounded in the BookLeaf Knowledge Base.

The project is split into two repositories. **This repo is the backend and holds the full project documentation.**

| | |
|---|---|
| **Backend (this repo)** | Express API, database, AI, Docker/Nginx deployment, docs, tests |
| **Frontend repo** | [`bookLeaf_assignment_frontend`](https://github.com/mozxmmil/bookLeaf_assignment_frontend): Next.js author and admin portals |
| **Live demo** | https://book-leaf-assignment-frontend.vercel.app |
| **Live API** | https://api-assignments.muzammil.live |
| **API docs** | [Swagger UI](https://api-assignments.muzammil.live/api/docs) · [`openapi.yaml`](./openapi.yaml) |
| **Write-up** | [`WRITEUP.md`](./WRITEUP.md) |
| **Deployment** | [`DEPLOYMENT.md`](./DEPLOYMENT.md): frontend on Vercel, backend on a VPS with Docker |
| **Planning docs** | [`docs/`](./docs/): PRD, UI/UX, architecture, API spec, AI strategy |

### Test credentials

Sign in on the live demo with any of these:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@bookleaf.com` | `admin123` |
| Admin | `support@bookleaf.com` | `admin123` |
| Author (2 published books) | `priya.sharma@email.com` | `author123` |
| Author (one book in production, one under the ₹1,000 payout minimum) | `kavita.deshmukh@email.com` | `author123` |
| Any other author in the dataset | their email from `bookleaf_sample_data.json` | `author123` |

---

## Features

**Author portal**
- Email/password login. Every query is scoped to the logged-in author.
- **My Books**: title, ISBN, genre, publication date, status, MRP, copies sold, royalty earned / paid / pending, plus portfolio totals. Live books also show royalty per copy, last payout date, print partner and the stores they are sold on. Books still in production show a stage tracker instead of zeros. Pending balances under ₹1,000 carry a "rolls over" hint.
- **Raise a query**: book dropdown (or "General / Account level"), subject, details, and an attachment picker (UI only). Opening the form from a book card pre-selects that book.
- **My Tickets**: status filters, reply counts, and a threaded conversation that **updates live over SSE** when an admin replies or changes the status. Authors can send follow-ups; a follow-up reopens a resolved ticket.

**Admin portal**
- **Ticket queue**: filter by status, category, priority, assignee, date range and free text. The default sort is *unresolved → most urgent → oldest*. Critical tickets get a red edge, tickets older than 48 h get ⚠, and tickets waiting on us show "awaiting reply". Stat cards double as one-click filters. New tickets appear live.
- **AI classification + priority** on every new ticket. Both can be overridden; overrides are kept separate from the AI's original output so accuracy can be measured.
- **AI draft reply** is generated automatically when the ticket opens. It uses the relevant Knowledge Base section plus verified facts (royalty figures, next payout date, production stage). The admin can edit or regenerate it before sending.
- **Ticket management**: status changes with enforced transitions, internal notes (never visible to authors), assign to me, and the author's other open tickets.
- **Graceful degradation**: if the AI is down or not configured, tickets are still created and classified by keyword rules, and the reply box switches to manual mode with a retry button.

---

## Architecture

```
 Next.js 15 (React 19, Tailwind)          Express 5 API (TypeScript)                PostgreSQL 16
 ┌───────────────────────────┐  REST   ┌──────────────────────────────────┐       ┌────────────┐
 │ Author portal │ Admin     │ ──────▶ │ routes → controllers → services  │ ────▶ │ Prisma 7   │
 │ (client components)       │ ◀────── │ middleware: auth · RBAC · zod    │       │ (Docker,   │
 │ EventSource (live)        │   SSE   │ realtime/sse  ai/ (provider,     │       │  port 5440)│
 └───────────────────────────┘         │ prompts, KB, rules, retries)     │       └────────────┘
                                       └──────────────┬───────────────────┘
                                                      │ HTTPS (server-side only)
                                                      ▼
                                              Google Gemini Flash
```

```
bookLeaf_assignment_backend/     (this repo)
├── .env.example              # backend config: DB, JWT, Gemini, CORS, dev DB port
├── docker-compose.yml        # dev: Postgres on host port 5440
├── docker-compose.prod.yml   # VPS: Postgres + API (API on 127.0.0.1:4815 for Nginx), see DEPLOYMENT.md
├── .env.prod.example         # template for the VPS .env (docker-compose.prod.yml)
├── Dockerfile                # API image
├── nginx/bookleaf-api.conf   # Nginx site for the VPS: reverse proxy, SSE unbuffered (HTTPS via Certbot)
├── docker/                   # init SQL (creates the test database)
├── prisma/                   # schema.prisma + migrations
├── data/                     # bookleaf_sample_data.json: official BookLeaf dataset (seed source)
├── src/
│   ├── config/env.ts         # zod-validated env (fails fast)
│   ├── db/                   # Prisma client, enums, seed
│   ├── middleware/           # authenticate, requireRole, validate, errorHandler
│   ├── modules/              # auth, books, tickets (author), admin
│   ├── ai/                   # provider interface, Gemini adapter, prompts, KB, rules, aiService
│   ├── realtime/sse.ts       # SSE hub
│   └── utils/                # AppError, royalty maths
├── tests/                    # vitest + supertest (API, AI, realtime)
├── scripts/ai-eval.ts        # runs the brief's sample queries through the AI
├── e2e/                      # Playwright end-to-end scripts + fake Gemini (drive both apps)
├── docs/                     # planning docs
└── openapi.yaml

bookLeaf_assignment_frontend/    (separate repo)
├── .env.example              # NEXT_PUBLIC_API_URL only
└── src/app/                  # author/*, admin/*, login
```

The two repos share no code or config. Each has its own `package.json`, `.env` file and deploy target.

| | Local config file | Read in | In production |
|---|---|---|---|
| Backend | `.env` | `src/config/env.ts` (validated with zod at startup) | `.env` on the VPS (from `.env.prod.example`) |
| Frontend | `.env.local` | `src/lib/api.ts` (`NEXT_PUBLIC_API_URL`) | Vercel → Project Settings → Environment Variables |

### Key decisions

| Decision | Why |
|---|---|
| **Separate Express API** instead of Next.js API routes | SSE needs long-lived connections, which serverless functions handle poorly. It also gives a clean REST boundary and independent scaling. |
| **Layering**: route → service → Prisma | Controllers only handle HTTP. Business rules (status transitions, override precedence, draft caching) live in services that are easy to test. |
| **PostgreSQL + Prisma** | The data is relational (author → books → tickets → messages/notes). Postgres enums sort in declaration order, so "most urgent first" is a plain `ORDER BY`. Prisma 7's TS engine + `pg` adapter means no native binary at runtime. |
| **`royaltyPending` derived, not stored** | Pending = earned − paid can never drift out of sync. |
| **AI fields stored twice** (`aiCategory` vs `category`) | Admin overrides never get clobbered by re-classification, and override rate becomes a built-in accuracy metric (`/admin/stats`). |
| **SSE over WebSockets** | Updates only flow server → client. SSE is simpler, auto-reconnects, and works through proxies. The client falls back to 15 s polling if the stream drops. |
| **JWT Bearer + httpOnly cookie** | Bearer works when the frontend and API are on different domains (Vercel ↔ the API's own domain) without third-party-cookie issues. The cookie is also set for same-site setups. |
| **404 instead of 403** for other authors' resources | Ticket and book IDs can't be probed. |

---

## How the AI works

Full details are in [`docs/05_AI_STRATEGY.md`](./docs/05_AI_STRATEGY.md) (planning doc) and [`src/ai/`](./src/ai/).

**Model: Google Gemini 3.5 Flash**, falling back to **3.5 Flash-Lite** (configurable via `GEMINI_MODEL` and `GEMINI_FALLBACK_MODELS`). It is cheap, has low latency, supports **native JSON mode with a response schema** for reliable classification, and has a free tier. Free-tier quotas are counted per model, so a fallback chain also multiplies the usable quota. "Thinking" is disabled (`thinkingBudget: 0`) because these tasks don't need it and thinking tokens are billed. Models that reject that setting (the Flash-Lite family) get the request resent without it. All calls go through an `LLMProvider` interface, so switching to OpenAI or Claude means writing one adapter file.

**1. Classification and priority** (async, after the ticket is saved)
- A small system prompt holds the category definitions and the priority rubric, but **no KB policies**. The ticket text is capped at 1,500 chars, with `temperature 0` and `maxOutputTokens 120`.
- The output is validated with zod. Invalid JSON or unknown enum values fall back to keyword rules.
- A **rules safety floor** can raise (never lower) priority for strong signals such as "no royalty for 6 months" or "wrong ISBN".

**2. Draft reply** (when an admin opens a ticket)
- The prompt is built from: the system persona + tone guidelines + **only the KB section for the ticket's category** + one calibrated example from BookLeaf's sample table + **verified facts computed in code** (royalty earned/paid/pending, next payout date = quarter end + 45 days, below-threshold rollover, production stage, ISBN) + the ticket + **the last 2 messages only**.
- Rules in the prompt: never invent numbers, give a 48-hour timeline when facts are missing, sign off as the admin.
- Author text is fenced in `<ticket>` / `<history>` tags and treated as data (prompt-injection guard).

**Cost controls**
- Only one KB section per draft instead of the whole KB (about 70% fewer prompt tokens).
- Drafts are **cached** on the ticket and reused until a new message arrives or the admin clicks Regenerate.
- History is truncated to the last 2 messages, and output tokens are capped.
- Numbers are computed in code, which saves tokens and prevents hallucination.
- Token usage is logged per call and exposed at `GET /api/v1/admin/ai/usage`.

**Failure handling**
- 15 s timeout, 2 retries with exponential backoff + jitter, applied only to retryable errors (429, 5xx, network).
- **Model fallback**: an overloaded model (503) gets one retry, then the next model in `GEMINI_FALLBACK_MODELS` is tried.
- **Quota awareness**: when Google's `RetryInfo` says to wait more than 10 s (per-minute or daily quota used up), that model is not retried. It is skipped until the delay passes, so no requests are wasted on it. If every model is cooling down, the call fails immediately and the app drops to rules/manual mode.
- Classification failure → keyword rules (`aiSource = "rules"`) and a "Retry AI classification" button.
- Draft failure → `{ draft: null, aiAvailable: false }` → the UI shows a "write manually" banner.
- A missing `GEMINI_API_KEY` is a supported mode, not a crash.
- The API key lives only in the backend's `.env`. It is sent in the `x-goog-api-key` header (never in a URL) and never reaches the frontend.

---

## Run locally

**Prerequisites:** Node 20+, Docker Desktop.

### 1. Backend (this repo): config and Postgres (Docker, port 5440)

```bash
git clone https://github.com/mozxmmil/bookLeaf_assignment_backend.git
cd bookLeaf_assignment_backend
cp .env.example .env          # then set JWT_SECRET and GEMINI_API_KEY
docker compose up -d          # bookleaf-db on localhost:5440 (+ bookleaf_test DB for tests)
```

> Port **5440** is used so it won't clash with an existing Postgres on 5432.
> Check it's free first: Windows `netstat -ano | findstr :5440` · macOS/Linux `lsof -i :5440`.
> To use another port, change `POSTGRES_PORT` and the port in `DATABASE_URL`, both in `.env`.

### 2. Backend: API

```bash
npm install                   # also runs `prisma generate`
npm run db:migrate            # prisma migrate deploy
npm run db:seed               # loads data/bookleaf_sample_data.json + 2 admins + 3 demo tickets
npm run dev                   # http://localhost:4000  (Swagger: /api/docs)
```

Get a Gemini key at <https://aistudio.google.com/app/apikey>. Without one, the app still works in keyword-rules + manual-reply mode.

### 3. Frontend (separate repo)

```bash
git clone https://github.com/mozxmmil/bookLeaf_assignment_frontend.git
cd bookLeaf_assignment_frontend
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev                   # http://localhost:3000
```

### Tests

```bash
npm test                      # 59 tests: API, RBAC, lifecycle, AI fallback/retries/prompts, SSE
npm run ai:eval               # sample queries from the brief → category accuracy + draft fact coverage

# End-to-end (with API on :4000 and web on :3000, freshly seeded)
cd e2e && npm install && npm test    # 17 browser checks across both portals + live updates
```

`e2e/ai-draft.e2e.mjs` covers the AI happy path against a local fake Gemini (`e2e/fake-gemini.mjs`) so it runs offline.

### Useful scripts (backend)

| Script | What it does |
|---|---|
| `npm run db:migrate` | Apply committed migrations (`prisma migrate deploy`) |
| `npm run db:migrate:dev` | Create a new migration after editing `schema.prisma` |
| `npm run db:seed` | Wipe and reseed (`-- --no-demo` to skip demo tickets) |
| `npm run db:studio` | Browse data in Prisma Studio |

---

## API overview

All routes are under `/api/v1`. The full spec is [`openapi.yaml`](./openapi.yaml), served as Swagger UI at `/api/docs`.

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/auth/login` · `/auth/logout` · GET `/auth/me` | public / any | Session |
| GET | `/books`, `/books/:id` | author | Own books + derived royalty |
| GET/POST | `/tickets` | author | List / create own tickets |
| GET | `/tickets/:id` | author | Ticket + public thread |
| POST | `/tickets/:id/messages` | author | Follow-up |
| GET | `/admin/tickets` | admin | Queue with filters, sort, pagination |
| GET/PATCH | `/admin/tickets/:id` | admin | Detail / status + override category & priority |
| POST | `/admin/tickets/:id/assign` · `/reclassify` · `/draft` · `/messages` · `/notes` | admin | Ticket actions |
| GET | `/admin/stats` · `/admin/ai/usage` | admin | Queue & AI metrics |
| GET | `/stream?token=` | any | SSE events |

Errors are always `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [{ "field", "message" }] } }`, with codes 400 / 401 / 403 / 404 / 409 / 503 / 500.

---

## Known limitations and next steps

- **Attachments** are UI-only (the file name is stored). Next step: S3/R2 pre-signed uploads.
- **Background jobs** run in-process. In production, move classification to a queue (BullMQ + Redis) for retries and visibility.
- **SSE hub is in-memory** (single instance). To scale out, back it with Redis pub/sub.
- **Auth**: no password reset or refresh tokens; the token lives in localStorage (XSS trade-off documented). Production would use short-lived access tokens plus httpOnly refresh cookies on a shared parent domain.
- **KB retrieval** is category-keyed. With a larger KB, switch to embeddings + pgvector to pull the top-k chunks.
- **Ops**: rate limiting, structured logging, metrics, and email notifications to authors.
