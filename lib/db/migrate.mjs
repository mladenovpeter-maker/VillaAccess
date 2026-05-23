#!/usr/bin/env node
// ─── Production migration runner ────────────────────────────────────────────
//
// Applies every *.sql file in ./migrations/ in lexicographic order against
// the database pointed to by DATABASE_URL.
//
// Design properties (all required for clean Docker/CI startup):
//   * Non-interactive — never prompts, no TTY needed.
//   * Idempotent — already-applied files are recorded in __migrations and
//     skipped on re-run. Safe to invoke unconditionally at every startup.
//   * Transactional — each file runs inside BEGIN…COMMIT; a failure rolls
//     back that file's changes and exits 1 with the real Postgres error
//     printed to stderr (no pnpm/drizzle wrapper to swallow it).
//   * Pure runtime deps — uses only `pg` (already in lib/db node_modules);
//     no drizzle-kit, no esbuild bundling, no TypeScript compilation step.
//
// Used by the Docker `migrate` service in docker-compose.yml, replacing the
// previous `drizzle-kit push` invocation which was interactive-by-design
// and broke whenever the schema diff contained anything destructive.

import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { Client } = pg;
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "migrations");

if (!process.env.DATABASE_URL) {
  console.error("[migrate] FATAL: DATABASE_URL is not set");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function run() {
  await client.connect();

  // Tracking table — intentionally separate from drizzle-kit's internal
  // `drizzle.__drizzle_migrations` so dev workflows that still use
  // `drizzle-kit push` for fast iteration never collide with production
  // migration state.
  await client.query(`
    CREATE TABLE IF NOT EXISTS __migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query("SELECT name FROM __migrations")).rows.map((r) => r.name),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log(`[migrate] no migration files found in ${MIGRATIONS_DIR}`);
    return;
  }

  let appliedNow = 0;
  let skipped = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] ✓ ${file} (already applied)`);
      skipped++;
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    console.log(`[migrate] → applying ${file}`);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO __migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`[migrate] ✓ ${file} (applied)`);
      appliedNow++;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`[migrate] ✗ ${file} FAILED`);
      console.error(err);
      throw err;
    }
  }

  console.log(
    `[migrate] done — ${appliedNow} newly applied, ${skipped} already applied, ${files.length} total`,
  );
}

run()
  .then(() => client.end().then(() => process.exit(0)))
  .catch((err) => {
    console.error("[migrate] FATAL", err);
    client.end().finally(() => process.exit(1));
  });
