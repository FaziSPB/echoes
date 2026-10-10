import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { env } from './env';
import { log } from './log';

/** Shared pool. Rows come back camelCased; insert helpers accept camelCase keys. */
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  transform: postgres.camel,
  onnotice: () => {},
});

export type Sql = typeof sql;

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Minimal forward-only migrator: runs each migrations/*.sql once, in name order. */
export async function migrate(): Promise<void> {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(MIGRATIONS_DIR + file, 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    log.info({ file }, 'migration applied');
  }
}

/** Drop undefined keys so column defaults apply and postgres.js doesn't reject undefined. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
