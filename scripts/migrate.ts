import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL ausente.');
const migrations = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });

await client.connect();
try {
  await client.query('SELECT pg_advisory_lock($1, $2)', [7349, 1]);
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const name of (await readdir(migrations)).filter(x => /^\d+_[\w-]+\.sql$/.test(x)).sort()) {
    const sql = await readFile(join(migrations, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const prior = await client.query<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
    if (prior.rows.length) {
      if (prior.rows[0].checksum !== checksum) throw new Error(`Migration alterada após aplicação: ${name}`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      await client.query('COMMIT');
      process.stdout.write(`Aplicada: ${name}\n`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock($1, $2)', [7349, 1]);
  await client.end();
}
