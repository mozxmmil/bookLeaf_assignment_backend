import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

/**
 * Single shared Prisma client. Prisma 7 uses a pure-TypeScript query engine
 * with the node-postgres driver adapter (no native engine binary needed at runtime).
 */
const needsSsl = /sslmode=require|neon\.tech|supabase\.co|render\.com/.test(env.DATABASE_URL);

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL, ssl: needsSsl ? { rejectUnauthorized: false } : undefined }),
});
