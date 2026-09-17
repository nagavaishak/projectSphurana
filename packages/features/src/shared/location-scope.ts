import {
  type SQL,
  and,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
} from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { DbConnection } from './core/types.js';

/**
 * Location scoping for entities that live in a JOIN table
 * (`organization_service_location`, `membership_plan_location`,
 * `product_location`, `offer_location`, `practitioner_location`).
 *
 * THE CONVENTION, stated once here because getting it wrong empties the app:
 *
 *   **Zero join rows means "available at every branch."**
 *
 * That is what the schema comments on `product_location` and
 * `membership_plan_location` already say, and it is the only convention under
 * which these tables can land without a backfill — they are all EMPTY today.
 * If a location filter meant "must have a row for this branch", switching a
 * branch on would blank out every catalogue in production at once.
 *
 * So the predicate is: has a row for THIS location, OR has no rows at all.
 * Once an owner starts assigning a service to branches, the second arm stops
 * matching for that service and the assignment takes effect — per entity, with
 * no flag day.
 *
 * @param db          the connection the subqueries are built from
 * @param joinTable   e.g. `organizationServiceLocation`
 * @param ownerColumn the join column pointing at the entity, e.g. `.serviceId`
 * @param entityId    the entity's own id column, e.g. `organizationService.id`
 * @param locationColumn the join column pointing at the location
 * @param locationId  the branch being filtered to
 */
/**
 * Branch filter for a table that owns a NULLABLE `location_id` of its own —
 * appointments, sales, stock takes, stock orders.
 *
 * Matches the branch OR a row that has no branch yet. The second arm is the
 * important one: `eq()` is NULL-hostile, so a plain equality filter hides every
 * row written before the location backfill ran. Those rows exist in production
 * right now — the backfill is a manual script, not a migration — and a diary or
 * a takings report that silently reads empty is indistinguishable from data
 * loss to the person looking at it.
 *
 * A NULL row therefore shows at EVERY branch until it is backfilled. That is
 * the deliberate trade: over-showing an unfiled row is recoverable by looking;
 * hiding it is not.
 *
 * This arm becomes dead once the backfill has run and `location_id` is
 * tightened to NOT NULL (redesign plan §12). Remove it then — not before.
 */
export function atLocationOrUnscoped(
  column: PgColumn,
  locationId: string
): SQL {
  // `or()` is typed as possibly-undefined because it drops undefined args;
  // with two literal conditions it never is.
  return or(eq(column, locationId), isNull(column)) as SQL;
}

export function atLocationOrUnassigned(
  db: DbConnection,
  joinTable: PgTable,
  ownerColumn: PgColumn,
  entityId: PgColumn,
  locationColumn: PgColumn,
  locationId: string
): SQL {
  // UNCORRELATED subqueries (`IN` / `NOT IN`), not `EXISTS` correlated on the
  // outer table.
  //
  // The correlated form referenced the outer table BY NAME
  // (`... where osl.service_id = organization_service.id`), which is only valid
  // while that table appears unaliased in the enclosing FROM clause. It does
  // not inside `withPublicOrgScope` — the public booking config read 500'd with
  // `invalid reference to FROM-clause entry for table "organization_service"`,
  // taking the customer-facing booking page down for every org with a branch.
  // The other seven callers happened to survive, which is the worst version of
  // this: one shared helper, valid in some query builders and not others, with
  // no signal until a specific endpoint is hit.
  //
  // Neither subquery mentions the outer table, so both are valid wherever the
  // predicate is used. `NOT IN` is safe here because every one of these join
  // tables declares its owner column NOT NULL — a NULL in that set would make
  // `NOT IN` return NULL for every row and silently empty the list.
  const assignedHere = inArray(
    entityId,
    db
      .select({ owner: ownerColumn })
      .from(joinTable)
      .where(eq(locationColumn, locationId))
  );
  const assignedNowhere = notInArray(
    entityId,
    db.select({ owner: ownerColumn }).from(joinTable)
  );

  // `or` over two defined predicates is always defined; the cast keeps the
  // return type non-nullable for callers pushing onto a `SQL[]`.
  return or(assignedHere, assignedNowhere) as SQL;
}

/**
 * The WRITE counterpart of `atLocationOrUnassigned` — "also make this available
 * at these branches", the operation behind "import from another location".
 *
 * Shared rather than written out per entity because the rule that makes it
 * correct is subtle and identical across all five join tables, and a copy that
 * loses it fails SILENTLY:
 *
 *   **Zero rows means every branch, so adding a branch to an entity that has
 *   no rows must be a NO-OP** — inserting the one row would narrow it from
 *   "available everywhere" to "available at that branch only", i.e. an import
 *   that takes the item away from every OTHER branch.
 *
 * Also idempotent: every one of these join tables is unique on
 * (entity, location), and a re-sent import must not 409 — "make sure it is
 * offered here" is already true.
 *
 * Returns the branch ids the entity is linked to afterwards. An EMPTY array
 * keeps its usual meaning (every branch), which is what the no-op returns.
 *
 * The caller supplies `buildRow`, so tables WITH override columns (the service
 * join carries per-branch price and duration) name them themselves — a new
 * branch inherits the catalogue value, so an import writes them null.
 */
export async function addLocationLinks<TRow extends Record<string, unknown>>(
  db: DbConnection,
  joinTable: PgTable,
  options: {
    ownerColumn: PgColumn;
    ownerId: string;
    locationColumn: PgColumn;
    locationIds: string[];
    /**
     * Builds one join row. The CALLER writes it, so the column names are its
     * own typed property names (`serviceId`, `planId`, `offerId`) rather than
     * something this helper guesses from the schema — Drizzle's `.values()`
     * takes TS keys, not the snake_case DB columns a `PgColumn` reports.
     */
    buildRow: (locationId: string) => TRow;
  }
): Promise<string[]> {
  const { ownerColumn, ownerId, locationColumn, locationIds, buildRow } =
    options;

  const current = (await db
    .select({ locationId: locationColumn })
    .from(joinTable)
    .where(eq(ownerColumn, ownerId))) as { locationId: string }[];

  // Already available at every branch — see the note above.
  if (current.length === 0) return [];

  const have = new Set(current.map((row) => row.locationId));
  const missing = locationIds.filter((id) => !have.has(id));

  if (missing.length > 0) {
    await db
      .insert(joinTable)
      .values(missing.map(buildRow))
      .onConflictDoNothing();
  }

  return [...have, ...missing];
}

/**
 * Take one branch OFF an entity — the write behind "remove from this location"
 * on a delete prompt.
 *
 * THE HARD CASE, and the reason this is shared rather than written per entity:
 * **zero rows means every branch**, so an entity with no rows cannot express
 * "everywhere except Cork" by deleting a row — there is no row to delete, and
 * doing nothing leaves it offered in Cork. Removing a branch from an unassigned
 * entity therefore MATERIALISES the complement: it writes a row for every other
 * branch in the org, which says the same thing the empty set did minus this
 * one.
 *
 * Returns `null` when the caller asked to remove the LAST remaining branch.
 * That state — "offered nowhere" — is not expressible in this model and never
 * was: zero rows reads as everywhere, so writing it back would silently do the
 * OPPOSITE of what the operator asked. `isActive: false` is how a business
 * withdraws something, and the caller is expected to say so rather than
 * pretending the removal happened.
 *
 * @param orgLocationIds every branch the organisation has — needed only for the
 *                       materialise case, and passed in because this helper has
 *                       no business reading the locations table.
 */
export async function removeLocationLink(
  db: DbConnection,
  joinTable: PgTable,
  options: {
    ownerColumn: PgColumn;
    ownerId: string;
    locationColumn: PgColumn;
    locationId: string;
    orgLocationIds: string[];
    buildRow: (locationId: string) => Record<string, unknown>;
  }
): Promise<string[] | null> {
  const {
    ownerColumn,
    ownerId,
    locationColumn,
    locationId,
    orgLocationIds,
    buildRow,
  } = options;

  const current = (await db
    .select({ locationId: locationColumn })
    .from(joinTable)
    .where(eq(ownerColumn, ownerId))) as { locationId: string }[];

  // Offered everywhere: write the complement rather than deleting nothing.
  if (current.length === 0) {
    const remaining = orgLocationIds.filter((id) => id !== locationId);

    // A single-branch org removing its only branch is the "nowhere" case.
    if (remaining.length === 0) return null;

    await db
      .insert(joinTable)
      .values(remaining.map(buildRow))
      .onConflictDoNothing();
    return remaining;
  }

  const remaining = current
    .map((row) => row.locationId)
    .filter((id) => id !== locationId);

  // Removing the last explicit branch would leave zero rows, which reads as
  // "everywhere" — the exact opposite of the request.
  if (remaining.length === 0) return null;

  await db
    .delete(joinTable)
    .where(and(eq(ownerColumn, ownerId), eq(locationColumn, locationId)));

  return remaining;
}
