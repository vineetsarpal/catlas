import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

try {
  const connection = process.env.DATABASE_URL;
  if (!connection) throw new Error('DATABASE_URL is missing');
  const url = new URL(connection);
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech')) throw new Error('Disposable Neon database required');
  const source = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  // This controlled migration keeps top-level CREATE/INSERT in column zero;
  // function bodies are indented and remain single statements.
  const statements = source.trim().split(/;\r?\n(?=(?:(?:[ \t]*--[^\r\n]*)?\r?\n)*(?:CREATE|INSERT)\s)/).filter(Boolean);
  const topLevelCount = source.match(/^(?:CREATE|INSERT)\s/gm)?.length ?? 0;
  if (statements.length !== topLevelCount) throw new Error('Unsupported controlled schema statement layout');
  const sql = neon(connection, { fetchOptions: { signal: AbortSignal.timeout(60_000) } });
  await sql.transaction(statements.map(statement => sql.query(statement, [])));
  console.log(JSON.stringify({ status: 'applied', statements: statements.length, schemaSha256: createHash('sha256').update(source).digest('hex') }));
} catch {
  console.error('Migration failed. Check the private DATABASE_URL, disposable Neon access, and schema permissions. Connection details are not logged.');
  process.exitCode = 1;
}
