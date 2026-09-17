/**
 * Compile-time assertions for the guarded {@link sql} tag.
 *
 * This file contains NO runtime behaviour — every statement lives inside a
 * function that is never called. Its entire job is to be type-checked by
 * `tsc -p tsconfig.lib.json` (the package `typecheck` script, run in CI).
 *
 * The `@ts-expect-error` directives are the actual test: if the guard ever
 * regresses and starts accepting a raw `Date`, the suppressed line stops
 * erroring, the directive becomes unused, and `tsc` fails with TS2578
 * ("Unused '@ts-expect-error' directive") — turning a silent regression into
 * a red build. Reproduces the #637 / ENG-479 pattern.
 */
import { text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from './sql-tag.js';

// Column values so we can exercise a Drizzle Column param (a SQLWrapper).
const tbl = { createdAt: timestamp('created_at'), id: text('id') };

function __compileTimeAssertions(now: Date, iso: string, n: number): void {
  // --- VALID: every legitimate param type is accepted unchanged --------------
  sql`select 1`;
  sql`where s = ${iso}`; // ISO string — the correct fix for a Date
  sql`where n = ${n} and b = ${true} and z IS ${null}`;
  sql`where col = ${tbl.createdAt}`; // Drizzle Column (SQLWrapper)
  sql`nested ${sql`inner`} tail`; // nested SQL
  sql`ids in ${[1, 2, 3]}`; // array param
  const chained: ReturnType<typeof sql> = sql`a ${n}`; // returns SQL<unknown>
  void chained;
  sql.raw('literal'); // static method preserved
  sql.join([sql`a`, sql`b`]); // static method preserved

  // --- INVALID: a raw Date param must be a compile error (the #637 bug) ------
  // @ts-expect-error raw Date interpolated into sql`` — must be rejected
  sql`where created_at >= ${now}`;

  // @ts-expect-error Date mixed with valid params — only the Date is rejected
  sql`s = ${iso} and t >= ${now} and n = ${n}`;

  // @ts-expect-error a freshly-constructed Date literal is rejected too
  sql`where created_at >= ${new Date()}`;
}

void __compileTimeAssertions;
