# Approach – BookLeaf Author Support Portal

**What I prioritised.** I followed the brief's order: the core ticket lifecycle and the AI integration first, polish second. I treated AI as one unreliable dependency inside a reliable system. A ticket is saved before any AI call. Classification runs asynchronously and falls back to deterministic keyword rules. A failed draft switches the admin to manual mode instead of showing an error. I spent most of the AI effort on **grounding**: each draft gets only the Knowledge Base section for its category, one calibrated example from BookLeaf's own table, and *verified facts computed in code*, such as pending royalty, the next payout date (quarter end + 45 days) and the below-₹1,000 rollover. The model writes the tone; it never decides the numbers.

**Trade-offs.**
- *Separate Express API vs Next.js API routes*: two deployments, but real-time SSE works reliably and the REST boundary stays clean.
- *Category-keyed KB vs embeddings*: the KB is small and maps neatly to the six categories, so a lookup is cheaper, deterministic and easy to test. Embeddings would be the next step for a larger KB.
- *Cached drafts*: one AI call per ticket state instead of one per page view. The cache is invalidated on new messages or a category change.
- *Storing AI output separately from effective values*: a little redundancy, but admin overrides are never overwritten, and the override rate becomes a live accuracy metric.
- *In-process job runner and SSE hub*: simple and fully tested, but single-instance. I documented this rather than adding Redis for a demo.
- *Bearer token in localStorage*: avoids cross-site cookie problems between Vercel and the API domain, at some XSS exposure. Production would use httpOnly refresh cookies on a shared domain.

**Quality.** The repo has 59 automated API/unit tests: RBAC, author data isolation, validation, status transitions, override precedence, AI retries/model fallback/quota handling/prompt contents, the Gemini adapter, royalty maths and SSE delivery. It also has 21 Playwright end-to-end checks, including the AI happy path against a local fake Gemini, plus an eval script that runs the brief's sample queries through the AI.

**Taking it to production.**
1. **Reliability:** move AI jobs to a queue (BullMQ/Redis) with dead-lettering, back the SSE hub with Redis pub/sub, and add rate limiting, structured logs and tracing.
2. **AI quality loop:** log every draft against what was actually sent (edit distance) and every override. Use these as a labelled dataset to tune prompts and track accuracy per category. Add a nightly eval run in CI.
3. **Smarter context:** chunk the full policy docs with embeddings (pgvector) and pull live data (per-platform sales, payout transaction status, production stage history) through tools, so drafts can answer "where is my payment?" with a transaction reference.
4. **Automation with guard-rails:** auto-send high-confidence answers to low-risk General queries, with a human approving everything financial or ISBN-related. Add SLA timers and escalation for Critical tickets.
5. **Author experience:** email/WhatsApp notifications, real attachment uploads (S3 pre-signed URLs), a self-serve royalty breakdown page, and Hindi replies.
