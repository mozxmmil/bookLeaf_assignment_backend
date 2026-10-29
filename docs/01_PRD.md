# PRD – BookLeaf Author Support & Communication Portal

| | |
|---|---|
| Version | 1.0 |
| Owner | Muzammil |
| Status | Draft |
| Deadline | 5 days from assignment receipt |

## 1. Problem Statement
BookLeaf handles thousands of authors. Support queries (royalties, ISBN, printing, distribution, production status) are answered manually, causing slow responses, inconsistent answers and backlogs during peak periods.

## 2. Goal
Build a web portal that lets authors raise and track support tickets, and lets the ops team triage and respond faster using AI-assisted classification, prioritisation and response drafting.

### Success Metrics (how we'd measure in production)
- Median first-response time ↓ (target: < 4 business hours)
- % of AI drafts sent with minimal edits ↑ (target: > 60%)
- AI classification accuracy vs admin override (target: > 85%)
- Zero tickets lost when AI provider fails

## 3. Users / Personas
| Persona | Need |
|---|---|
| **Author** (e.g. first-time writer in India) | Know book status & royalties, get quick, honest answers |
| **Support Admin** (BookLeaf ops) | See what's urgent, answer correctly per policy, fast |

## 4. Scope

### In Scope (MVP)
**Author Portal**
- A1 Email/password login (seeded authors)
- A2 My Books: title, ISBN, genre, publication date, status, MRP, copies sold, royalty earned / paid / pending
- A3 Create ticket: book dropdown (+ "General / Account Level"), subject, description, attachment (UI only)
- A4 My Tickets: list + detail, status, admin replies, near-real-time updates (SSE)

**Admin Portal**
- B1 Ticket queue with filters (status, category, priority, date) and sort (priority, then oldest)
- B2 AI auto-classification into 6 categories, admin override
- B3 AI priority (Critical/High/Medium/Low), admin override
- B4 AI-drafted reply using Knowledge Base + author/book data; editable before send
- B5 Status update, internal notes (admin only), assign to self

**Platform**
- C1 REST API, JWT auth middleware, RBAC (author / admin)
- C2 Input validation (Zod) + consistent error format
- C3 OpenAPI/Swagger docs
- C4 Graceful AI fallback, token-efficient prompts
- C5 Deployed live URL with seeded data

### Out of Scope
- OTP / social login, password reset
- Real file storage (bonus only if time allows)
- Email notifications
- Multi-language replies

## 5. User Stories
| ID | As a… | I want to… | So that… |
|---|---|---|---|
| US1 | Author | log in and see only my books | my data stays private |
| US2 | Author | see royalty earned / paid / pending | I know what I'm owed |
| US3 | Author | raise a ticket about a specific book | the team has context |
| US4 | Author | see replies without refreshing | I feel heard quickly |
| US5 | Admin | see Critical & oldest tickets first | nothing urgent is missed |
| US6 | Admin | get an AI category & priority | triage is instant |
| US7 | Admin | get a policy-accurate draft reply | I respond in seconds |
| US8 | Admin | correct AI category/priority | data stays accurate |
| US9 | Admin | add internal notes & assign to me | team coordinates |
| US10 | Admin | still work when AI is down | support never stops |

## 6. Functional Requirements – Ticket Lifecycle
```
Author submits → Ticket created (status=OPEN, ai_status=PENDING)
             → AI classify + prioritise (async)  → ai_status=DONE | FAILED
Admin opens  → AI draft generated (cached)      → Admin edits → Send
             → status=IN_PROGRESS (auto on first reply) → RESOLVED → CLOSED
Author sees reply instantly via SSE
```
Statuses: `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`

Categories: Royalty & Payments · ISBN & Metadata Issues · Printing & Quality · Distribution & Availability · Book Status & Production Updates · General Inquiry

## 7. Non-Functional Requirements
- **Security:** API keys only in server env; bcrypt passwords; JWT; RBAC on every route
- **Reliability:** AI failure never blocks ticket creation; timeouts + retry with backoff
- **Cost:** only relevant KB sections sent; drafts cached per ticket; short classification prompt
- **Performance:** queue loads < 1s for seeded data
- **Edge cases:** books in production (no ISBN/sales), zero royalties, no tickets (empty states)

## 8. Edge Cases
| Case | Expected behaviour |
|---|---|
| Book in production | Show stage badge, sales/royalty show "—" not 0 confusion |
| Royalty = 0 / pending < ₹1,000 | Explain threshold rollover in UI tooltip & AI reply |
| AI API down / rate-limited | Ticket saved, category "Unclassified", admin writes manually, retry button |
| AI returns invalid JSON | Validate with schema, fallback to defaults |
| Author tries another author's ticket | 404 (don't leak existence) |
| Empty ticket list | Friendly empty state + "Raise a ticket" CTA |

## 9. Milestones (5 days)
See `06_TASKS_5_DAY_PLAN.md`.

## 10. Open Questions (email BookLeaf)
1. Sample data JSON file `bookleaf_sample_data.json` – please share if missing
2. Collaborator email for the repo
3. Should admin accounts be seeded by us? (Assumed: yes, 1–2 admins)
