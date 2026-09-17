import { type SQL, sql as drizzleSql } from 'drizzle-orm';

/**
 * Guarded re-export of Drizzle's `sql` template tag.
 *
 * ## Why this exists
 *
 * A JavaScript `Date` interpolated into a raw `db.execute(sql`…`)` /
 * `sql`…`` template is silently accepted by TypeScript — Drizzle types the
 * tag's params as `any[]` — but blows up at runtime. Under the `postgres-js`
 * driver a raw `Date` param triggers `Buffer.byteLength(date)`, which throws:
 *
 *     TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of type
 *     string ... Received an instance of Date
 *
 * This crashed the nightly operational-snapshot writer in production (Sentry
 * API-BC, 785 occurrences; ENG-479 / PR #637). Neither `tsc` nor Biome caught
 * it: the failure is a runtime driver-serialization error hidden behind `any`.
 *
 * Drizzle's *typed* operators (`gte`/`lte`/`eq` on timestamp columns) map
 * `Date` through the column type and are unaffected — the hazard is ONLY the
 * raw-SQL escape hatch.
 *
 * ## What this does
 *
 * `sql` here is the exact same runtime tag as `drizzle-orm`'s `sql` (statics
 * like `sql.raw`, `sql.join`, `sql.identifier`, `sql.placeholder` are all
 * preserved), but its call signature rejects any interpolated `Date` at
 * compile time. Every other legitimate param — strings, numbers, booleans,
 * `null`, columns, tables, nested `SQL`, arrays — is accepted unchanged, so
 * the guard is strictly additive: it introduces zero false positives and only
 * fails the exact `#637` pattern.
 *
 * ## The fix at a call site
 *
 * ```ts
 * // ❌ throws at runtime, now a compile error too:
 * db.execute(sql`WHERE created_at >= ${someDate}`);
 *
 * // ✅ pre-format to an ISO string (the driver coerces it server-side):
 * db.execute(sql`WHERE created_at >= ${someDate.toISOString()}`);
 *
 * // ✅ when the value is used arithmetically, cast it explicitly:
 * db.execute(sql`EXTRACT(EPOCH FROM (${now.toISOString()}::timestamptz - t))`);
 * ```
 */

// A branded type used purely as the "poison" that a `Date` param collapses to.
// When a call site interpolates a `Date`, the corresponding parameter type
// becomes this, and `Date` is not assignable to it — surfacing a compile
// error at exactly that argument. The message property makes the fix
// discoverable from the tsc error / editor hover.
declare const RAW_SQL_DATE_PARAM: unique symbol;
export type RawSqlDateParamNotAllowed = {
  readonly [RAW_SQL_DATE_PARAM]: 'Do not interpolate a `Date` into a raw sql`` template — the postgres-js driver throws ERR_INVALID_ARG_TYPE. Call `.toISOString()` (and cast `::timestamptz` if used arithmetically). See PR #637 / ENG-479.';
};

/**
 * Per-element guard over the tuple of interpolated params: any element that is
 * a `Date` is mapped to {@link RawSqlDateParamNotAllowed}; everything else is
 * passed through untouched. Because the tuple `P` is inferred from the actual
 * call, non-`Date` params keep their exact types (no widening, no rejection).
 */
export type GuardSqlDateParams<P extends readonly unknown[]> = {
  [K in keyof P]: P[K] extends Date ? RawSqlDateParamNotAllowed : P[K];
};

type DrizzleSqlTag = typeof drizzleSql;

// Copy every static member of the Drizzle `sql` tag (`.raw`, `.join`,
// `.identifier`, `.placeholder`, `.fromList`, `.empty`, …) verbatim; only the
// call signature below is overridden.
type DrizzleSqlStatics = { [K in keyof DrizzleSqlTag]: DrizzleSqlTag[K] };

export interface GuardedSqlTag extends DrizzleSqlStatics {
  <T = unknown, P extends readonly unknown[] = readonly unknown[]>(
    strings: TemplateStringsArray,
    ...params: GuardSqlDateParams<P>
  ): SQL<T>;
}

/**
 * Drizzle's `sql` tag, re-typed to reject raw `Date` interpolation at compile
 * time. Runtime behaviour is identical to `drizzle-orm`'s `sql`.
 */
export const sql: GuardedSqlTag = drizzleSql as unknown as GuardedSqlTag;
