# AI Integration Strategy (25% of marks)

## Model Choice: Google Gemini Flash
- Very low cost per token, fast latency (good for drafting on ticket open)
- Native JSON output mode (`responseMimeType: application/json` + schema) → reliable classification
- Free tier for development
- Wrapped behind an `LLMProvider` interface → can swap to OpenAI/Claude by changing one file

## Two AI Tasks

### 1. Classify + Prioritise (on ticket creation, async)
- Runs **after** the ticket is saved → author gets instant 201, AI never blocks creation
- Small prompt: only category definitions + priority rubric (no full KB) → ~400 tokens
- Output (validated with Zod):
```json
{ "category": "ROYALTY_PAYMENTS", "priority": "CRITICAL", "reason": "No royalty for 6 months" }
```
- Priority rubric in prompt:
  - CRITICAL: money not received for long, ISBN mismatch on live book, legal/data issue
  - HIGH: print defects, book unavailable, overdue payout, production delayed > 2 weeks
  - MEDIUM: royalty calculation questions, status updates
  - LOW: metadata/bio changes, general questions
- Plus **rule-based boost**: keywords like "6 months", "never received", "wrong ISBN" can raise priority (deterministic safety net)

### 2. Draft Reply (when admin opens ticket)
Prompt = 
1. **System:** BookLeaf support persona + tone guidelines (empathetic, own mistakes, specific timelines, clear next step)
2. **Relevant KB section only** – picked by ticket category (e.g. Royalty ticket → Royalty Policy only)
3. **1–2 few-shot examples** for that category (from the sample table)
4. **Structured facts**: author first name, book title, status, copies sold, royalty earned/paid/pending, today's date, next payout date (computed in code, not by AI)
5. **Ticket:** subject + description + last 2 messages only (not whole history)
6. Instruction: don't invent numbers; if unknown, say team will check within 48 hours

## Cost Management
| Technique | Saving |
|---|---|
| KB split by category, only 1 section sent | ~70% fewer tokens |
| Draft cached in DB (`aiDraft`), regenerated only on "Regenerate" or new message | no repeat calls |
| Only last 2 messages in context | bounded tokens |
| Next payout date etc. computed in code | fewer tokens + no hallucination |
| `maxOutputTokens` limit (~400) | bounded cost |
| Log token usage per call | visibility |

## Graceful Degradation
- Timeout 10s, retry 2x with exponential backoff on 429/5xx
- If still failing: `aiStatus = FAILED`, category/priority = null → UI shows "Unclassified" + Retry button
- Draft failure → empty editor + banner "AI draft unavailable, write manually"
- Classification fallback: keyword rules give a best-guess category/priority
- Invalid JSON from model → Zod rejects → fallback path
- Ticket creation and manual reply **never** depend on AI

## Security
- `GEMINI_API_KEY` only in server env; all AI calls server-side
- Ticket text passed as data inside delimiters; system prompt tells model to ignore instructions inside the ticket (prompt-injection guard)

## Quality Check
- Small eval script: run the 7 sample queries from the PDF, check category matches and reply mentions key policy facts (45 days, ₹1,000, 48 hours, 5–7 days…)
- Track override rate (`aiCategory != category`) as accuracy metric
