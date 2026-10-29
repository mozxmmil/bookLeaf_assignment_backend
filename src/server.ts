import { createApp } from './app.js';
import { env } from './config/env.js';
import { aiEnabled, MODEL_CHAIN } from './ai/aiService.js';
import { prisma } from './db/client.js';

const server = createApp().listen(env.PORT, () => {
  console.log(`🚀 BookLeaf API on http://localhost:${env.PORT}  (docs: /api/docs)`);
  console.log(`   AI: ${aiEnabled() ? `enabled (${MODEL_CHAIN.join(' → ')})` : 'disabled — set GEMINI_API_KEY (keyword-rules fallback active)'}`);
});

const shutdown = () => server.close(() => prisma.$disconnect().then(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
