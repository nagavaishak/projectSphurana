/**
 * Postgres constraint-violation detection.
 *
 * A check-then-insert ("does this name exist? no → insert it") is never atomic:
 * a concurrent request can insert the same row between the SELECT and the
 * INSERT, so the INSERT loses the race and raises a unique violation. The
 * correct handling is to treat that violation as the same domain outcome the
 * pre-check would have produced (e.g. ALREADY_EXISTS) rather than letting a raw
 * PostgresError escape as an INTERNAL_ERROR/500.
 *
 * Note this is the opposite of `isTransientDbError` in ./retry.ts — a constraint
 * violation is deterministic and must NOT be retried.
 */

/** SQLSTATE 23505 — unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** SQLSTATE 23P01 — exclusion_violation. */
const EXCLUSION_VIOLATION = '23P01';

/** SQLSTATE 23503 — foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = '23503';

/** SQLSTATE 40P01 — deadlock_detected. */
const DEADLOCK_DETECTED = '40P01';

/**
 * Walk an error and its `cause` chain, collecting every link. drizzle-orm wraps
 * the underlying postgres.js error ("Failed query: …") and carries the real
 * error — which holds `code` and `constraint_name` — on `err.cause`. Chains can
 * be several levels deep, so a single-level unwrap misses the real cause.
 */
function causeChain(error: unknown, maxDepth = 10): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current != null && depth < maxDepth) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
    depth += 1;
  }
  return chain;
}

/**
 * Is this error a Postgres unique-constraint violation?
 *
 * @param error - The caught error (may be a drizzle wrapper around postgres.js).
 * @param constraintName - Optional. When given, only matches that specific
 *   constraint, so a service handling one race doesn't silently swallow an
 *   unrelated unique violation on the same table.
 */
export function isUniqueViolation(
  error: unknown,
  constraintName?: string
): boolean {
  for (const link of causeChain(error)) {
    const code = (link as { code?: unknown }).code;
    if (code !== UNIQUE_VIOLATION) continue;

    if (!constraintName) return true;

    // postgres.js exposes the constraint as `constraint_name`; some drivers
    // use `constraint`. Fall back to the message, which embeds the constraint
    // name as: duplicate key value violates unique constraint "name_unique".
    const link_ = link as {
      constraint_name?: unknown;
      constraint?: unknown;
      message?: unknown;
    };
    const named = link_.constraint_name ?? link_.constraint;
    if (typeof named === 'string') return named === constraintName;
    if (typeof link_.message === 'string') {
      return link_.message.includes(constraintName);
    }
  }
  return false;
}

/**
 * Is this error a Postgres EXCLUSION-constraint violation?
 *
 * The overlap analogue of `isUniqueViolation`, and it exists for the same
 * reason: `appointment_no_overlap` and `resource_no_overlap` are the DB
 * backstops behind an application-layer availability check, and that check is a
 * check-then-insert — two concurrent bookings can both observe "Room 2 is free"
 * and both try to hold it. The loser must surface as the domain outcome
 * (CONFLICT — "that room was just taken"), never as a 500.
 *
 * ⚠️ DO NOT pattern-match the thrown error's `message` for the constraint name.
 * drizzle 0.45.2 re-throws every failed query as a `DrizzleQueryError` whose
 * message is `"Failed query: <the SQL>\nparams: …"` — the real driver error,
 * with `code` and `constraint_name`, is on `.cause`. An INSERT's SQL text does
 * not contain the constraint name, so a message match silently NEVER fires and
 * the violation escapes as INTERNAL_ERROR. (An integration suite hit exactly
 * this: 15 assertions written as `rejects.toThrow(/constraint_name/)` matched
 * the SQL rather than the constraint.) Always go through this helper.
 *
 * @param error - The caught error (may be a drizzle wrapper around postgres.js).
 * @param constraintName - Optional. When given, only matches that specific
 *   constraint, so a service handling one overlap race doesn't swallow an
 *   unrelated exclusion violation.
 */
export function isExclusionViolation(
  error: unknown,
  constraintName?: string
): boolean {
  for (const link of causeChain(error)) {
    const code = (link as { code?: unknown }).code;
    if (code !== EXCLUSION_VIOLATION) continue;

    if (!constraintName) return true;

    const link_ = link as {
      constraint_name?: unknown;
      constraint?: unknown;
      message?: unknown;
    };
    const named = link_.constraint_name ?? link_.constraint;
    if (typeof named === 'string') return named === constraintName;
    if (typeof link_.message === 'string') {
      return link_.message.includes(constraintName);
    }
  }
  return false;
}

/**
 * Is this error a Postgres deadlock (SQLSTATE 40P01)?
 *
 * The THIRD way a concurrent write can lose, and the one that is easy to miss
 * because it is not a constraint violation at all.
 *
 * An exclusion constraint is enforced by each inserter checking for conflicting
 * index entries and WAITING on the transaction that owns any it finds. When two
 * transactions each insert an entry the other conflicts with, each ends up
 * waiting on the other's xid — a genuine cycle — and Postgres resolves it by
 * killing one with 40P01 rather than reporting 23P01 to either. So the SAME
 * race surfaces as 23P01 or 40P01 depending on how the two transactions
 * interleave, which is why a handler that recognises only 23P01 passes locally
 * and then returns a 500 on a loaded machine. (CI caught exactly that: the
 * loser of two concurrent room moves got INTERNAL_ERROR, with "deadlock
 * detected" in the log, on a test that had been green for weeks.)
 *
 * ⚠️ Unlike the two helpers above there is no constraint name to narrow on, so a
 * deadlock says only "you lost a race with a concurrent writer" — NOT which
 * rows it was over. Only treat it as a specific domain conflict where the
 * surrounding transaction is small enough that no other cycle is possible (see
 * the two resource-hold writers). In a transaction that touches several
 * unrelated tables, a deadlock is not evidence about any one of them, and
 * reporting it as "that slot was just booked" would be a guess.
 *
 * The victim's transaction is rolled back in full, so nothing partial was
 * written and the caller is free to report a clean conflict or retry.
 */
/**
 * Is this error a Postgres foreign-key violation?
 *
 * Distinct from the race that `isUniqueViolation` handles: an FK violation
 * usually means the row being POINTED AT is not there — most often an
 * `organization_id` or `user_id` that has been deleted while a cached session
 * still names it. Left unhandled it escapes as an INTERNAL_ERROR/500 saying
 * "An unexpected error occurred", which tells the caller nothing and hides a
 * knowable, reportable condition.
 *
 * @param error - The caught error (may be a drizzle wrapper around postgres.js).
 * @param constraintName - Optional. When given, only matches that specific
 *   constraint, so a service handling one missing parent does not swallow an
 *   unrelated FK violation on the same write.
 */
export function isForeignKeyViolation(
  error: unknown,
  constraintName?: string
): boolean {
  for (const link of causeChain(error)) {
    const code = (link as { code?: unknown }).code;
    if (code !== FOREIGN_KEY_VIOLATION) continue;

    if (!constraintName) return true;

    const link_ = link as {
      constraint_name?: unknown;
      constraint?: unknown;
      message?: unknown;
    };
    const named = link_.constraint_name ?? link_.constraint;
    if (typeof named === 'string') return named === constraintName;
    if (typeof link_.message === 'string') {
      return link_.message.includes(constraintName);
    }
  }
  return false;
}

export function isDeadlock(error: unknown): boolean {
  for (const link of causeChain(error)) {
    if ((link as { code?: unknown }).code === DEADLOCK_DETECTED) return true;
  }
  return false;
}

/** The bits of a Postgres error a service needs to build its own domain error. */
export interface PgViolationInfo {
  code: string;
  constraint?: string;
  detail?: string;
  table?: string;
}

/**
 * Extract the underlying Postgres error info (SQLSTATE code, constraint name,
 * detail, table) from anywhere in the `.cause` chain, or `null` if this isn't
 * a Postgres error at all.
 *
 * This is the general-purpose escape hatch behind `isUniqueViolation` /
 * `isForeignKeyViolation` / `isExclusionViolation` for call sites that need
 * more than a boolean — e.g. to report which field collided, or to fan out
 * on constraint name via `mapDbError` below. `packages/database` intentionally
 * has no knowledge of `FeatureError`/`ErrorCodes` (those live in
 * `packages/features/src/shared`), so this returns plain data and leaves
 * building the domain error to the caller.
 */
export function pgViolation(error: unknown): PgViolationInfo | null {
  for (const link of causeChain(error)) {
    const code = (link as { code?: unknown }).code;
    if (typeof code !== 'string') continue;
    // Only recognise known constraint-violation classes — a random `code`
    // field on an unrelated error (e.g. a Node error code like 'ENOENT')
    // must not be reported as a Postgres violation.
    if (
      code !== UNIQUE_VIOLATION &&
      code !== EXCLUSION_VIOLATION &&
      code !== FOREIGN_KEY_VIOLATION &&
      code !== DEADLOCK_DETECTED
    ) {
      continue;
    }

    const link_ = link as {
      constraint_name?: unknown;
      constraint?: unknown;
      detail?: unknown;
      table_name?: unknown;
    };
    const constraint = link_.constraint_name ?? link_.constraint;
    return {
      code,
      ...(typeof constraint === 'string' && { constraint }),
      ...(typeof link_.detail === 'string' && { detail: link_.detail }),
      ...(typeof link_.table_name === 'string' && {
        table: link_.table_name,
      }),
    };
  }
  return null;
}

/**
 * Map a Postgres constraint violation to a caller-built domain error, keyed by
 * constraint name. Returns `null` if the error isn't a violation on any
 * constraint in `map` — the caller should fall through to its generic
 * INTERNAL_ERROR handling in that case (an unrecognised constraint must never
 * be silently swallowed).
 *
 * @example
 * } catch (error) {
 *   const mapped = mapDbError(error, {
 *     uq_intake_form_org_name: () =>
 *       new FeatureError(ErrorCodes.ALREADY_EXISTS, 'An intake form with that name already exists'),
 *   });
 *   if (mapped) return err(mapped);
 *   // ...generic INTERNAL_ERROR handling
 * }
 */
export function mapDbError<T>(
  error: unknown,
  map: Record<string, () => T>
): T | null {
  const violation = pgViolation(error);
  if (!violation?.constraint) return null;
  const build = map[violation.constraint];
  return build ? build() : null;
}
