/**
 * Request CONTRACTS — the canonical, `.strict()` Zod schema for each write
 * endpoint's BODY (the twin of `../responses`).
 *
 * DIRECTION OF DERIVATION — wire -> server. These files are the SOURCE; the
 * backend feature schemas DERIVE from them by `.extend()`ing server-injected
 * context fields (e.g. `organizationId`) onto the exported `*RequestBase`.
 * Because the server schema literally IS the wire schema plus fields, it can
 * never be laxer, and no drift is possible. Do NOT invert this.
 *
 * Each file exports a matched pair, because `.refine()` returns a ZodEffects
 * which has no `.extend()`:
 *   - `<name>RequestBase`   — plain `z.object({…})`, EXTENDABLE (not strict).
 *   - `<name>RequestSchema` — `<name>RequestBase.strict()` (+ any `.refine()`),
 *     used to VALIDATE a wire body.
 *
 * See ./REQUEST-CONTRACTS.md for the endpoint list and ./leads.ts for the
 * reference implementation.
 */
export * from './appointments.js';
export * from './redirect-url.js';
export * from './campaigns.js';
export * from './catalog.js';
export * from './content.js';
export * from './conversations.js';
export * from './deposits.js';
export * from './inventory.js';
export * from './leads.js';
export * from './organizations.js';
export * from './sales.js';
export * from './scheduling.js';
export * from './team.js';
