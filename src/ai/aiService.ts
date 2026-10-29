import { z } from 'zod';
import { env } from '../config/env.js';
import { CATEGORY_VALUES, PRIORITY_VALUES, type Category, type Priority } from '../db/enums.js';
import { GeminiProvider } from './gemini.js';
import { AIProviderError, type GenerateRequest, type GenerateResult, type LLMProvider } from './provider.js';
import { CLASSIFY_SCHEMA, CLASSIFY_SYSTEM, DRAFT_SYSTEM, buildClassifyPrompt, buildDraftPrompt, type DraftContext } from './prompts.js';
import { applyPriorityFloor, rulesCategory, rulesPriority } from './rules.js';

/**
 * AI orchestration: timeouts, retries with backoff, model fallback, output validation and usage logging.
 * Callers never see provider errors for classification (rules fallback),
 * and get a typed AIUnavailableError for drafts (UI switches to manual mode).
 */

export const MODEL_CHAIN = [...new Set([env.GEMINI_MODEL, ...env.GEMINI_FALLBACK_MODELS])];

let providers: LLMProvider[] = env.GEMINI_API_KEY
  ? MODEL_CHAIN.map((m) => new GeminiProvider(env.GEMINI_API_KEY, m, env.GEMINI_BASE_URL))
  : [];
/** Models whose quota ran out, skipped until the time the provider told us to come back. */
const cooldownUntil = new Map<LLMProvider, number>();

/** Test / DI hooks. Pass null to simulate "no API key configured". */
export function setProviders(list: LLMProvider[]) { providers = list; cooldownUntil.clear(); }
export function setProvider(p: LLMProvider | null) { setProviders(p ? [p] : []); }
export const aiEnabled = () => providers.length > 0;

export class AIUnavailableError extends Error {}

const MAX_RETRIES = 2;
// Short "retry after" hints are worth waiting for; longer ones mean the quota is used up, so switch model instead.
const MAX_INLINE_WAIT_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Simple running totals — visible at GET /api/v1/admin/ai/usage. In production: push to metrics.
export const usageStats = { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, byTask: {} as Record<string, { calls: number; inputTokens: number; outputTokens: number }> };

async function callWithRetry(task: string, req: GenerateRequest): Promise<GenerateResult> {
  if (!providers.length) throw new AIUnavailableError('AI is not configured (missing GEMINI_API_KEY)');
  const now = Date.now();
  const ready = providers.filter((p) => (cooldownUntil.get(p) ?? 0) <= now);
  if (!ready.length) {
    const minutes = Math.ceil((Math.min(...cooldownUntil.values()) - now) / 60_000);
    usageStats.failures++;
    throw new AIUnavailableError(`AI quota used up on every configured model; next one frees up in ~${minutes} min`);
  }

  let lastErr: unknown;
  for (const [i, p] of ready.entries()) {
    const isLast = i === ready.length - 1;
    // Earlier models get one retry before we move on; the last model gets the full budget.
    const retries = isLast ? MAX_RETRIES : 1;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await p.generate(req, AbortSignal.timeout(env.AI_TIMEOUT_MS));
        usageStats.calls++;
        usageStats.inputTokens += result.usage.inputTokens;
        usageStats.outputTokens += result.usage.outputTokens;
        const t = (usageStats.byTask[task] ??= { calls: 0, inputTokens: 0, outputTokens: 0 });
        t.calls++; t.inputTokens += result.usage.inputTokens; t.outputTokens += result.usage.outputTokens;
        if (env.NODE_ENV !== 'test') console.log(`[ai] ${task} ok model=${result.model} in=${result.usage.inputTokens} out=${result.usage.outputTokens}`);
        return result;
      } catch (e) {
        lastErr = e;
        const err = e instanceof AIProviderError ? e : null;
        if (err?.retryAfterMs && err.retryAfterMs > MAX_INLINE_WAIT_MS) {
          cooldownUntil.set(p, Date.now() + err.retryAfterMs); // quota exhausted: stop spending requests on it
          break;
        }
        if ((err && !err.retryable) || attempt === retries) break;
        await sleep(err?.retryAfterMs ?? 400 * 2 ** attempt + Math.random() * 200); // provider hint, else backoff + jitter
      }
    }
    if (!isLast && env.NODE_ENV !== 'test') console.warn(`[ai] ${task}: ${p.name} failed (${(lastErr as Error)?.message}), trying next model`);
  }
  usageStats.failures++;
  console.warn(`[ai] ${task} failed: ${(lastErr as Error)?.message}`);
  throw new AIUnavailableError((lastErr as Error)?.message ?? 'AI request failed');
}

// ---------- Classification ----------

const classificationSchema = z.object({
  category: z.enum(CATEGORY_VALUES),
  priority: z.enum(PRIORITY_VALUES),
  reason: z.string().max(500).default(''),
});

export interface Classification { category: Category; priority: Priority; reason: string; source: 'llm' | 'rules' }

export async function classifyTicket(input: { subject: string; description: string; bookTitle?: string | null; bookStatus?: string | null }): Promise<Classification> {
  const text = `${input.subject}\n${input.description}`;
  try {
    const res = await callWithRetry('classify', {
      system: CLASSIFY_SYSTEM,
      prompt: buildClassifyPrompt(input),
      maxOutputTokens: 120,
      temperature: 0,
      jsonSchema: CLASSIFY_SCHEMA,
    });
    const parsed = classificationSchema.parse(JSON.parse(stripFences(res.text)));
    return {
      category: parsed.category,
      priority: applyPriorityFloor(parsed.priority, text, parsed.category),
      reason: parsed.reason,
      source: 'llm',
    };
  } catch (e) {
    // AI down, rate limited, or returned junk → deterministic fallback so triage still works.
    const category = rulesCategory(text);
    return {
      category,
      priority: rulesPriority(text, category),
      reason: `Auto-classified by keyword rules (AI unavailable: ${(e as Error).message.slice(0, 80)})`,
      source: 'rules',
    };
  }
}

// ---------- Draft reply ----------

export async function draftReply(ctx: DraftContext): Promise<{ draft: string; usage: GenerateResult['usage'] }> {
  const res = await callWithRetry('draft', {
    system: DRAFT_SYSTEM,
    prompt: buildDraftPrompt(ctx),
    maxOutputTokens: 600,
    temperature: 0.4,
  });
  const draft = res.text.trim();
  if (draft.length < 40) throw new AIUnavailableError('AI returned an unusably short draft');
  return { draft, usage: res.usage };
}

const stripFences = (s: string) => s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
