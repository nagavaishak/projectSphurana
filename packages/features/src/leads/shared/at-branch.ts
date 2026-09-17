import { appointment, lead } from '@borradh-workspace/database';
import { type SQL, and, eq, exists, isNull, or } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

/**
 * "This customer belongs to this branch" — the ONE definition.
 *
 * Three arms, and each is load-bearing:
 *
 *  1. their home branch is this one;
 *  2. they have NO home branch — an unfiled customer belongs to every branch,
 *     the same "zero rows means everywhere" convention the catalogue uses;
 *  3. they hold an appointment AT this branch — the branch serving them today
 *     must see them even when head office is their home.
 *
 * Dropping arm 2 or 3 makes a real customer vanish from the branch that is
 * serving them, which is why the list has always carried all three.
 *
 * EXTRACTED because it was inline in `list-leads` and therefore impossible to
 * reuse: `get-lead-stage-counts` filtered by organization ALONE, so the tab
 * badges counted the whole org while the table under them counted one branch.
 * On the seeded three-branch demo that reads "All 36" above 24 rows, with
 * nothing on screen to explain the gap — and the counts service's own doc
 * claims "the counts and the list are the same expression, so a badge can
 * never disagree with the rows behind it". That was true of the derived STAGE
 * and false of the BRANCH. Sharing the predicate is what makes the claim true
 * again, rather than restating it in two places and hoping.
 *
 * `db` is threaded in because arm 3 is a correlated subquery and needs a
 * connection to build against; pass the same one the outer query runs on.
 */
export function leadAtBranch(db: DbConnection, branchId: string): SQL {
  return or(
    eq(lead.primaryLocationId, branchId),
    isNull(lead.primaryLocationId),
    exists(
      db
        .select({ one: appointment.id })
        .from(appointment)
        .where(
          and(
            eq(appointment.leadId, lead.id),
            eq(appointment.locationId, branchId)
          )
        )
    )
  ) as SQL;
}
