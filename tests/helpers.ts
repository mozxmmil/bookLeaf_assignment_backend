import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed, DEMO_ADMIN_PASSWORD, DEMO_AUTHOR_PASSWORD } from '../src/db/seed.js';
import { setProvider } from '../src/ai/aiService.js';
import type { LLMProvider, GenerateRequest } from '../src/ai/provider.js';
import { AIProviderError } from '../src/ai/provider.js';

export const app = createApp();
export const api = () => request(app);

export async function resetDb() {
  await seed({ withDemoTickets: false });
}

export async function login(email: string, password: string) {
  const res = await api().post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.token as string;
}

export const AUTHOR_A = { email: 'priya.sharma@example.com', password: DEMO_AUTHOR_PASSWORD, authorId: 'AUT001' };
export const AUTHOR_B = { email: 'michael.carter@example.com', password: DEMO_AUTHOR_PASSWORD, authorId: 'AUT004' };
export const ADMIN = { email: 'admin@bookleaf.com', password: DEMO_ADMIN_PASSWORD };

/** Scriptable fake LLM: records requests, returns queued responses or throws. */
export class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  calls: GenerateRequest[] = [];
  queue: (string | Error)[] = [];
  fallback: string | Error = new AIProviderError('no response queued', false);
  async generate(req: GenerateRequest) {
    this.calls.push(req);
    const next = this.queue.length ? this.queue.shift()! : this.fallback;
    if (next instanceof Error) throw next;
    return { text: next, model: 'fake-model', usage: { inputTokens: Math.ceil((req.system.length + req.prompt.length) / 4), outputTokens: Math.ceil(next.length / 4) } };
  }
}

export function useFakeAI() {
  const fake = new FakeProvider();
  setProvider(fake);
  return fake;
}
export const disableAI = () => setProvider(null);
