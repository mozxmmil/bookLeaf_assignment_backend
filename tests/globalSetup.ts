import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

/**
 * Recreate the test database schema from the committed Prisma migrations before the suite runs.
 * (Applies the migration SQL directly so tests don't need the Prisma schema-engine binary.)
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:bookleaf@localhost:5440/bookleaf_test';
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  const dir = path.resolve('prisma/migrations');
  for (const m of fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort()) {
    await client.query(fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8'));
  }
  await client.end();
}
