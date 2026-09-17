/**
 * @borradh-workspace/contracts — runtime Zod schemas for FE↔API responses.
 *
 * Pure Zod (deps: `zod` + `@borradh-workspace/labels`). Safe to import from the
 * frontend: no `drizzle-zod` / `drizzle-orm` / `@borradh-workspace/database` in
 * the runtime graph (those are build-time only, in `scripts/`).
 *
 * - `generated/*` — EMITTED atom schemas, one per Drizzle table (1:1 wire rows).
 * - `responses/*` — HAND-COMPOSED projections (the real API contract surface).
 * - `requests/*`  — HAND-COMPOSED `.strict()` write-endpoint BODY contracts.
 * - `wire.ts`     — the `toWire()` transform the generator runs.
 * - `fixture.ts`  — schema-validated test fixtures.
 */
export * from './wire.js';
export * from './fixture.js';
export * from './generated/index.js';
export * from './responses/index.js';
export * from './requests/index.js';
