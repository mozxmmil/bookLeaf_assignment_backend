# REST API Specification (v1)

Base URL: `/api/v1` · Auth: JWT httpOnly cookie · Content-Type: JSON
Full OpenAPI spec will live in `openapi.yaml` in this repo (Swagger UI at `/api/docs`).

## Auth
| Method | Endpoint | Role | Description |
|---|---|---|---|
| POST | `/auth/login` | public | `{email, password}` → sets cookie, returns user |
| POST | `/auth/logout` | any | clears cookie |
| GET | `/auth/me` | any | current user |

## Author
| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/books` | author | own books (+ computed `royaltyPending`) |
| GET | `/books/:id` | author | one own book |
| GET | `/tickets` | author | own tickets (`?status=`) |
| POST | `/tickets` | author | create `{bookId?, subject, description, attachmentName?}` → 201 |
| GET | `/tickets/:id` | author | own ticket + public messages (no internal notes) |

## Admin
| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/admin/tickets` | admin | queue. Query: `status, category, priority, assignee=me, from, to, sort, page, limit` |
| GET | `/admin/tickets/:id` | admin | ticket + author + book + messages + notes |
| PATCH | `/admin/tickets/:id` | admin | `{status?, category?, priority?}` (override) |
| POST | `/admin/tickets/:id/assign` | admin | assign to self |
| POST | `/admin/tickets/:id/draft` | admin | generate/regenerate AI draft (`?refresh=true`) |
| POST | `/admin/tickets/:id/messages` | admin | send reply `{body, isAiAssisted}` |
| POST | `/admin/tickets/:id/notes` | admin | internal note `{body}` |
| POST | `/admin/tickets/:id/reclassify` | admin | retry AI classification |
| GET | `/admin/stats` | admin | counts by status/priority (dashboard header) |

## Real-time
| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/stream` | any | SSE stream of ticket events |

## Example – Create Ticket
```http
POST /api/v1/tickets
{ "bookId": "BK001", "subject": "Royalty not received", "description": "It's been 6 months..." }
```
```json
201 Created
{ "data": { "id": "ck...", "number": 1024, "status": "OPEN", "aiStatus": "PENDING" } }
```

## Validation Rules
- subject: 5–150 chars · description: 20–5000 chars
- bookId must belong to the logged-in author (else 404)
- status transitions validated (e.g. CLOSED → OPEN not allowed except reopen rule)

## Response Envelope
Success: `{ "data": ..., "meta": { "page": 1, "total": 42 } }`
Error: `{ "error": { "code", "message", "details" } }`
