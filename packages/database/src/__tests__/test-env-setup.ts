/**
 * Vitest setup for the database package.
 *
 * The RLS specs (rls-helper-integration.test.ts) import the real
 * `rls-context.js`/`client.js`, which evaluate `databaseEnv` (createEnv) at
 * import time — that requires DATABASE_URL to be present or it throws and the
 * file fails to COLLECT (instead of skipping) in a normal `turbo test` run with
 * no DB env. The specs themselves are gated with `describe.skipIf` and never
 * connect unless the RLS role URLs are also set, so a placeholder here is safe:
 * it lets the module import, the suite then skips, and a real run (CI / local)
 * provides the real DATABASE_URL which takes precedence (`||=`).
 */
process.env.DATABASE_URL ||=
  'postgres://placeholder:placeholder@localhost:5432/placeholder';
process.env.NODE_ENV ||= 'test';
