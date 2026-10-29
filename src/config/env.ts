import 'dotenv/config';
import { z } from 'zod';

/** All configuration is read and validated once at startup — fail fast on bad config. */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  // Tried in order when the main model is rate-limited, overloaded or out of quota (free-tier quotas are per model).
  GEMINI_FALLBACK_MODELS: z.string().default('gemini-3.5-flash-lite')
    .transform((s) => s.split(',').map((m) => m.trim()).filter(Boolean)),
  // Override only for proxies / local testing; defaults to Google's public endpoint.
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta/models'),
  CLIENT_ORIGIN: z.string().default('http://localhost:3000'),
  AI_TIMEOUT_MS: z.coerce.number().default(15000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
