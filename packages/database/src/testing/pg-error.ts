/**
 * Test fixtures that reproduce the EXACT error shape drizzle 0.45.2 throws for
 * a Postgres constraint violation via postgres-js.
 *
 * drizzle wraps every failed query in a `DrizzleQueryError` whose `.message` is
 * `"Failed query: <sql>\nparams: …"` — never the constraint name — and carries
 * the real postgres.js `PostgresError` (with `.code`, `.constraint_name`,
 * `.detail`, `.table_name`) on `.cause`. A test that throws a flat
 * `new Error('duplicate key value violates unique constraint "x"')` does NOT
 * reproduce this shape and will pass against a service that only pattern-
 * matches `error.message` — hiding exactly the bug this ticket fixes (ENG-844).
 *
 * Always build fixtures with these factories rather than ad hoc `Object.assign`
 * calls, so every test proves the cause-chain-walking helpers in
 * `./constraints.ts` (`isUniqueViolation`, `isForeignKeyViolation`, …) actually
 * fire.
 */

interface PgErrorOptions {
  detail?: string;
  table?: string;
}

/**
 * Build a drizzle-wrapped Postgres unique-violation (SQLSTATE 23505), as
 * thrown for a duplicate key on `constraintName`.
 */
export function drizzleUniqueViolation(
  constraintName: string,
  options: PgErrorOptions = {}
): Error {
  const { detail, table } = options;
  const cause = Object.assign(
    new Error(
      `duplicate key value violates unique constraint "${constraintName}"`
    ),
    {
      code: '23505',
      constraint_name: constraintName,
      ...(detail !== undefined && { detail }),
      ...(table !== undefined && { table_name: table }),
    }
  );
  return Object.assign(
    new Error(`Failed query: insert into "${table ?? 'unknown'}" …`),
    { cause }
  );
}

/**
 * Build a drizzle-wrapped Postgres foreign-key-violation (SQLSTATE 23503), as
 * thrown when a write points at a parent row that does not exist.
 */
export function drizzleFkViolation(
  constraintName: string,
  options: PgErrorOptions = {}
): Error {
  const { detail, table } = options;
  const cause = Object.assign(
    new Error(
      `insert or update on table "${table ?? 'unknown'}" violates foreign key constraint "${constraintName}"`
    ),
    {
      code: '23503',
      constraint_name: constraintName,
      ...(detail !== undefined && { detail }),
      ...(table !== undefined && { table_name: table }),
    }
  );
  return Object.assign(
    new Error(`Failed query: insert into "${table ?? 'unknown'}" …`),
    { cause }
  );
}
