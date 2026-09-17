import { organizationLocation } from '@borradh-workspace/database';
import { asc, desc, eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

export interface DefaultLocation {
  id: string;
  country: string | null;
}

/**
 * The branch an entry point with NO branch in it belongs to: `isPrimary` wins,
 * ties break on the lowest `sortOrder`.
 *
 * WHY THIS EXISTS AS ONE FUNCTION. Three code paths were already picking "the
 * org's main location" with three hand-written orderings — the venue page, the
 * general booking config, and the deposit-currency fallback inside
 * `submitGeneralBooking` (that last one filtered on `isPrimary = true` with no
 * tie-break, so an org whose primary flag was never set resolved NOTHING and
 * silently fell through to a default currency). Once branch scoping is real,
 * disagreeing about which branch is "the" branch means the price quoted, the
 * currency charged and the calendar the appointment lands on can each pick a
 * different one.
 *
 * Returns `null` only for an org with no locations at all. Onboarding creates
 * one, so in practice this is the "org is mid-creation" case — callers treat
 * it as "no branch", never as an error.
 *
 * NOT a `Result`: every caller wants a value-or-nothing, and wrapping it would
 * make three call sites branch on an error they all handle identically.
 */
export const resolveDefaultLocation = async (
  db: DbConnection,
  organizationId: string
): Promise<DefaultLocation | null> => {
  const location = await db.query.organizationLocation.findFirst({
    where: eq(organizationLocation.organizationId, organizationId),
    orderBy: [
      desc(organizationLocation.isPrimary),
      asc(organizationLocation.sortOrder),
      // Stable tiebreak. Both columns above default to `false` / `0`, and
      // nothing at the database level enforces one primary per org — only
      // `createLocation` demotes the previous one, so anything writing the
      // table directly (the testing service, the backfills) can leave an org
      // with none set or several. Without a third key that org has a total tie
      // and Postgres may return a DIFFERENT row per call: the booking form
      // would price against one branch while the submit files the appointment
      // at another, in two separate requests.
      //
      // `id` matches what `scripts/backfill-location-ids.ts` already orders by,
      // so the app and the backfill agree on which branch is "the default"
      // rather than each picking its own.
      asc(organizationLocation.id),
    ],
    columns: { id: true, country: true },
  });

  return location ?? null;
};
