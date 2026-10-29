import { AIProviderError, type GenerateRequest, type GenerateResult, type LLMProvider } from './provider.js';

/**
 * Google Gemini adapter using the REST API directly (no SDK → fewer deps, full control).
 * The API key is sent in a header (never in the URL, so it can't leak into logs).
 */
export class GeminiProvider implements LLMProvider {
  readonly name: string;
  /** Set once the model has rejected `thinkingConfig` (Flash-Lite models answer it with a bare 400). */
  private thinkingUnsupported = false;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models',
  ) {
    this.name = `gemini/${model}`;
  }

  async generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
    if (this.thinkingUnsupported) return this.send(req, false, signal);
    try {
      return await this.send(req, true, signal);
    } catch (e) {
      if (!(e instanceof AIProviderError) || e.status !== 400) throw e;
      // Only remember the flag if the request works without it; other 400s are real errors.
      const result = await this.send(req, false, signal);
      this.thinkingUnsupported = true;
      return result;
    }
  }

  private async send(req: GenerateRequest, disableThinking: boolean, signal?: AbortSignal): Promise<GenerateResult> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxOutputTokens,
        // Flash models "think" by default and bill those tokens; these tasks don't need it.
        ...(disableThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        ...(req.jsonSchema ? { responseMimeType: 'application/json', responseSchema: req.jsonSchema } : {}),
      },
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/${this.model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError' || (e as Error).name === 'TimeoutError';
      throw new AIProviderError(aborted ? `${this.model}: request timed out` : `${this.model}: network error: ${(e as Error).message}`, true);
    }

    if (!res.ok) {
      const { detail, retryAfterMs } = parseGoogleError(await res.text().catch(() => ''));
      const retryable = res.status === 429 || res.status >= 500;
      throw new AIProviderError(`${this.model}: HTTP ${res.status} ${detail}`, retryable, res.status, retryAfterMs);
    }

    const json = (await res.json()) as any;
    const candidate = json.candidates?.[0];
    const text: string = candidate?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
    if (!text) {
      throw new AIProviderError(`${this.model}: returned no content (finishReason=${candidate?.finishReason ?? 'unknown'})`, false);
    }
    return {
      text,
      model: this.model,
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}

/**
 * Turns Google's error body into a one-line message plus its RetryInfo delay.
 * A 429 names the exhausted quota (e.g. "...PerDay...-FreeTier, limit 20"), which is what an operator needs to see.
 */
export function parseGoogleError(raw: string): { detail: string; retryAfterMs?: number } {
  let err: any;
  try { err = JSON.parse(raw).error; } catch { return { detail: raw.slice(0, 160) }; }
  if (!err) return { detail: raw.slice(0, 160) };
  const details: any[] = err.details ?? [];
  const delay = details.find((d) => typeof d.retryDelay === 'string')?.retryDelay as string | undefined;
  const retryAfterMs = delay ? Math.round(parseFloat(delay) * 1000) : undefined;
  const quota = details.flatMap((d) => d.violations ?? []).find((v: any) => v.quotaId);
  const firstSentence = String(err.message ?? err.status ?? '').split(/(?<=\.)\s/)[0].slice(0, 160);
  const parts = [quota ? `quota ${quota.quotaId} exceeded (limit ${quota.quotaValue})` : firstSentence];
  if (retryAfterMs) parts.push(`retry in ${Math.ceil(retryAfterMs / 1000)}s`);
  return { detail: parts.join(', '), retryAfterMs };
}
