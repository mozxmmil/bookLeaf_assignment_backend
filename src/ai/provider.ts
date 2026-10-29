/**
 * Provider-agnostic LLM interface. The rest of the app only talks to this,
 * so switching Gemini → OpenAI/Claude means adding one adapter file.
 */
export interface GenerateRequest {
  system: string;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
  /** When set, ask the model for JSON matching this (OpenAPI-subset) schema. */
  jsonSchema?: Record<string, unknown>;
}

export interface GenerateResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult>;
}

/**
 * Thrown by providers. `retryable` = worth retrying (429, 5xx, network, timeout).
 * `retryAfterMs` = the provider's own "retry after" hint; a long one means the quota is used up.
 */
export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}
