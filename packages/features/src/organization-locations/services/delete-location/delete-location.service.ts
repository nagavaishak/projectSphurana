import {
  appointment,
  membershipPlanLocation,
  metaCampaignConfig,
  offerLocation,
  organizationLocation,
  organizationServiceLocation,
  organizationServiceVariantLocation,
  practitionerLocation,
  productLocation,
  productStock,
  sale,
  stockOrder,
  stockTake,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, count, eq, inArray, lt } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { relocateFutureAppointments } from '../../../appointments/index.js';
import { withdrawProducts } from '../../../inventory/index.js';
import { relocateLeadHomeBranch } from '../../../leads/index.js';
import { withdrawMembershipPlans } from '../../../memberships/index.js';
import { withdrawOffers } from '../../../offers/index.js';
import { withdrawServices } from '../../../organization-services/index.js';
import { withdrawPractitioners } from '../../../practitioners/index.js';
import { relocateSchedule } from '../../../scheduling/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
  removeLocationLink,
} from '../../../shared/index.js';
import {
  type DeleteLocationInput,
  deleteLocationSchema,
} from './delete-location.schema.js';

/**
 * Rows that mean the branch has TRADED. Their presence refuses the delete.
 *
 * The line is drawn at trading history rather than at "any reference at all"
 * deliberately: a branch created by mistake has none of these, so delete stays
 * usable for the case people actually need it, while a branch that has taken
 * money requires a different verb (an archive flag — not in scope here).
 *
 * Why refuse rather than reassign: every one of these rows is a FINANCIAL
 * fact about a place. Moving Cork's takings, stock counts and completed
 * appointments onto Dublin does not preserve them, it falsifies them — Dublin's
 * day sheet, its P&L and its inventory would permanently include a branch that
 * never traded there, with no way to tell afterwards which rows were moved.
 *
 * `product_stock` is in this set even though its FK CASCADEs. That cascade is
 * the quiet one: it destroys the branch's per-SKU quantities outright, and the
 * numbers it deletes are the only record of what was physically on those
 * shelves.
 *
 * A FUNCTION, not a module-level const — see the identical note in
 * `apply-location-catalog.service.ts`. Each row dereferences a drizzle column,
 * and doing that at import time breaks every `apps/api` jest suite that loads
 * this module before the database barrel is ready.
 */
const blockingKinds = (locationId: string, now: Date) =>
  [
    {
      key: 'sales',
      table: sale,
      where: eq(sale.locationId, locationId),
    },
    {
      // PAST only. A future appointment is intent, not history, and is
      // reassigned below.
      key: 'pastAppointments',
      table: appointment,
      where: and(
        eq(appointment.locationId, locationId),
        lt(appointment.endDate, now)
      ) as SQL,
    },
    {
      key: 'stockTakes',
      table: stockTake,
      where: eq(stockTake.locationId, locationId),
    },
    {
      key: 'stockOrders',
      table: stockOrder,
      where: eq(stockOrder.locationId, locationId),
    },
    {
      key: 'productStock',
      table: productStock,
      where: eq(productStock.locationId, locationId),
    },
  ] as const;

type BlockingKey = ReturnType<typeof blockingKinds>[number]['key'];

/**
 * The join tables whose rows encode AVAILABILITY, where "zero rows means every
 * branch" (`shared/location-scope.ts`).
 *
 * `withdraw` is what to do with an entity whose ONLY branch is the one being
 * deleted (see the note on the loop below). Every one of them is the OWNING
 * feature's function, not an update written here: `organizationService`,
 * `membershipPlan` and `practitioner` are single-writer tables
 * (`architecture/single-writer.test.ts`), and more to the point each feature
 * knows what withdrawal means for its own rows — `offer` has no `isActive` at
 * all, it has a `state` enum with four members and only one right answer.
 */
const catalogueKinds = () =>
  [
    {
      key: 'services',
      join: organizationServiceLocation,
      ownerColumn: organizationServiceLocation.serviceId,
      locationColumn: organizationServiceLocation.locationId,
      ownerField: 'serviceId',
      withdraw: withdrawServices,
    },
    {
      key: 'products',
      join: productLocation,
      ownerColumn: productLocation.productId,
      locationColumn: productLocation.locationId,
      ownerField: 'productId',
      withdraw: withdrawProducts,
    },
    {
      key: 'membershipPlans',
      join: membershipPlanLocation,
      ownerColumn: membershipPlanLocation.planId,
      locationColumn: membershipPlanLocation.locationId,
      ownerField: 'planId',
      withdraw: withdrawMembershipPlans,
    },
    {
      key: 'offers',
      join: offerLocation,
      ownerColumn: offerLocation.offerId,
      locationColumn: offerLocation.locationId,
      ownerField: 'offerId',
      withdraw: withdrawOffers,
    },
    {
      key: 'practitioners',
      join: practitionerLocation,
      ownerColumn: practitionerLocation.practitionerId,
      locationColumn: practitionerLocation.locationId,
      ownerField: 'practitionerId',
      withdraw: withdrawPractitioners,
    },
  ] as const;

/** `SELECT count(*)` for one predicate. */
const countRows = async (
  db: DbConnection,
  table: PgTable,
  where: SQL
): Promise<number> => {
  const rows = (await db
    .select({ value: count() })
    .from(table)
    .where(where)) as { value: number }[];
  return Number(rows[0]?.value ?? 0);
};

/** The distinct entity ids that have an EXPLICIT row at this branch. */
const ownersAtLocation = async (
  db: DbConnection,
  join: PgTable,
  ownerColumn: PgColumn,
  locationColumn: PgColumn,
  locationId: string
): Promise<string[]> => {
  const rows = (await db
    .select({ ownerId: ownerColumn })
    .from(join)
    .where(eq(locationColumn, locationId))) as { ownerId: string }[];
  return [...new Set(rows.map((row) => row.ownerId))];
};

/**
 * Internal implementation of delete location
 *
 * TWO REFUSALS UP FRONT, both enforced HERE rather than in the UI, because the
 * UI is not a guard — `org-settings/tabs/locations.tsx` merely hides the button
 * for the primary branch, and `DELETE /organization-locations/:id` is reachable
 * regardless:
 *
 *  1. **The primary branch cannot be deleted.** It is what
 *     `resolveDefaultLocation` falls back to, what `syncOrganizationTimezone`
 *     derives the org timezone from, and what a single-location org's public
 *     venue URL resolves through. Promote another branch first.
 *  2. **The last remaining branch cannot be deleted.** Every
 *     `/dashboard/l/$handle` route resolves through `resolveDefaultLocation`;
 *     an org with zero locations has no branch for it to return and the
 *     dashboard has nowhere to land.
 *
 * WHAT HAPPENS TO THE ROWS THAT STILL POINT AT THE BRANCH — the FKs used to
 * answer for us, and both of their answers were lossy. The rows split three
 * ways, because they are three different problems:
 *
 *  1. **Availability join rows → REASSIGNED, never cascaded.** All six join
 *     tables are `ON DELETE cascade`, and zero join rows means "available at
 *     EVERY branch" (`shared/location-scope.ts`). A service assigned ONLY to
 *     the deleted branch has exactly one join row; letting the cascade drop it
 *     to zero PUBLISHES that branch's exclusive catalogue, its per-branch price
 *     overrides and its staff to every other branch and to the public booking
 *     page. Silently. `removeLocationLink` is used here precisely because it
 *     already encodes that inversion.
 *  2. **Trading history → REFUSED.** See `blockingKinds`.
 *  3. **Forward-looking rows → REASSIGNED to the primary branch.** Blocks, time
 *     off, shifts, FUTURE appointments, a lead's home branch and a campaign's
 *     geo target all describe INTENT, and intent has to land somewhere; left
 *     `set null` they become invisible to every strict-`eq` list service at
 *     every branch, with nothing left to backfill from.
 *
 * All of it in ONE transaction, opened explicitly: with `RLS_ENABLED` off (prod
 * today) `withOrgScope` is a passthrough and opens none, so without this a
 * failure halfway through would leave the catalogue half-reassigned and the
 * branch still present.
 */
const deleteLocationImpl = async (
  db: DbConnection,
  input: DeleteLocationInput
): Promise<Result<{ success: boolean }>> => {
  // Validate input
  const parsed = deleteLocationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  try {
    return await db.transaction(async (tx) => {
      // One read answers all three questions — does it exist and belong to this
      // org, is it the primary, and is it the last one standing.
      const locations = await tx.query.organizationLocation.findMany({
        where: eq(organizationLocation.organizationId, organizationId),
        columns: { id: true, isPrimary: true },
      });

      const existing = locations.find((location) => location.id === id);

      if (!existing) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found')
        );
      }

      // Checked before the primary guard: the only location is normally also
      // the primary, and "you cannot delete your only location" is the more
      // useful thing to be told — "make another one primary first" is
      // unactionable when there is no other one.
      if (locations.length <= 1) {
        return err(
          new FeatureError(
            ErrorCodes.CONFLICT,
            'Cannot delete the only location. An organization must have at least one location.',
            { reason: 'last_location', locationId: id }
          )
        );
      }

      if (existing.isPrimary) {
        return err(
          new FeatureError(
            ErrorCodes.CONFLICT,
            'Cannot delete the primary location. Make another location primary first, then delete this one.',
            { reason: 'primary_location', locationId: id }
          )
        );
      }

      const others = locations.filter((location) => location.id !== id);
      // The guards above guarantee at least one other branch. Preferring the
      // flagged primary and falling back to any sibling keeps this working on
      // an org whose primary flag was lost, rather than throwing on it.
      const primaryLocationId =
        others.find((location) => location.isPrimary)?.id ??
        (others[0] as { id: string }).id;

      // --- 2. Trading history → refuse -------------------------------------
      const now = new Date();
      const blocking: Partial<Record<BlockingKey, number>> = {};

      for (const kind of blockingKinds(id, now)) {
        const total = await countRows(tx, kind.table, kind.where);
        if (total > 0) blocking[kind.key] = total;
      }

      if (Object.keys(blocking).length > 0) {
        return err(
          new FeatureError(
            ErrorCodes.CONFLICT,
            'Cannot delete a location that has trading history. Its sales, completed appointments and stock records belong to this branch and moving them to another one would misstate both branches’ books.',
            { reason: 'trading_history', locationId: id, blocking }
          )
        );
      }

      // --- 1. Availability join rows → reassign ----------------------------
      // Only entities with an EXPLICIT row here need touching. An entity with
      // zero rows already means "every branch", and after the delete it still
      // means every REMAINING branch — the right answer, and a no-op.
      for (const kind of catalogueKinds()) {
        const ownerIds = await ownersAtLocation(
          tx,
          kind.join,
          kind.ownerColumn,
          kind.locationColumn,
          id
        );

        const offeredNowhere: string[] = [];

        for (const ownerId of ownerIds) {
          const remaining = await removeLocationLink(tx, kind.join, {
            ownerColumn: kind.ownerColumn,
            ownerId,
            locationColumn: kind.locationColumn,
            locationId: id,
            orgLocationIds: locations.map((location) => location.id),
            buildRow: (locationIdForRow) => ({
              [kind.ownerField]: ownerId,
              locationId: locationIdForRow,
            }),
          });

          // `null` = this branch was the entity's ONLY branch. "Offered
          // nowhere" is not expressible in a model where zero rows means
          // everywhere, so the helper refuses to write it and hands the
          // decision back. We WITHDRAW the entity rather than either dropping
          // it (which republishes it everywhere) or moving it to the primary
          // branch (which hands one branch's exclusive catalogue and its
          // per-branch prices to another). Nothing is deleted and one toggle
          // brings it back.
          if (remaining === null) offeredNowhere.push(ownerId);
        }

        if (offeredNowhere.length > 0) {
          await kind.withdraw(tx, offeredNowhere);

          // The helper declined to touch the row, so drop it here. The FK
          // cascade would take it anyway; doing it explicitly keeps the
          // withdraw and the unlink adjacent. The entity ends on zero rows —
          // i.e. "everywhere" again — which is exactly why it had to be
          // withdrawn first, and why re-activating it later re-publishes it
          // everywhere until an owner assigns branches.
          await tx
            .delete(kind.join)
            .where(
              and(
                inArray(kind.ownerColumn, offeredNowhere),
                eq(kind.locationColumn, id)
              )
            );
        }
      }

      // Variant location rows are the one exception, and are deleted outright.
      // They are PRICE OVERRIDES, not availability — nothing reads them through
      // `atLocationOrUnassigned` (`shared/service-location-pricing.ts` is the
      // only reader, and it looks up one branch's override), so zero rows for a
      // variant means "inherit the catalogue price", not "sold everywhere".
      // A deleted branch's override is meaningless and carries nowhere.
      await tx
        .delete(organizationServiceVariantLocation)
        .where(eq(organizationServiceVariantLocation.locationId, id));

      // --- 3. Forward-looking rows → reassign to the primary branch --------
      // Each through its OWNING feature: `appointment`, `lead`, `shift` and
      // `blocked_time` are single-writer tables, and the rule they enforce is
      // the right one here too — what a closed branch means for a diary or a
      // customer's home branch is that feature's decision, not this one's.
      await relocateSchedule(tx, {
        fromLocationId: id,
        toLocationId: primaryLocationId,
      });

      // Only the future half — the past half already refused the delete above,
      // so the boundary inside the helper is belt-and-braces against a booking
      // landing between the count and the update inside this transaction.
      await relocateFutureAppointments(tx, {
        fromLocationId: id,
        toLocationId: primaryLocationId,
        notBefore: now,
      });

      await relocateLeadHomeBranch(tx, {
        fromLocationId: id,
        toLocationId: primaryLocationId,
      });

      // Written inline, unlike the four above: `meta_campaign_config.location_id`
      // is not a diary or an owner, it is the campaign's GEO INPUT — the address
      // the radius is centred on. Campaign history that spent money is kept (the
      // FK is `set null`), but that input has to name a real address or the next
      // sync geocodes nothing.
      await tx
        .update(metaCampaignConfig)
        .set({ locationId: primaryLocationId })
        .where(eq(metaCampaignConfig.locationId, id));

      // Delete the location.
      //
      // KNOWN, DELIBERATELY NOT HANDLED HERE: this orphans
      // `organization_location.stripe_terminal_location_id` — a `tml_…` object
      // that stays alive in Stripe with nothing left pointing at it, and
      // nothing else in the codebase ever cleans up. Deleting it needs a Stripe
      // API call on a delete path (failure mode, ordering against the commit,
      // and whether a Terminal location with historical readers should be
      // deleted at all), which is its own decision and its own lane.
      await tx
        .delete(organizationLocation)
        .where(eq(organizationLocation.id, id));

      return ok({ success: true });
    });
  } catch (error) {
    logError('organization-locations.deleteLocation', error, {
      feature: 'organization-locations',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to delete location. Please try again.'
      )
    );
  }
};

/**
 * Delete a location from an organization
 */
export const deleteLocation = (db: DbConnection, input: DeleteLocationInput) =>
  trackedResult(
    'organization-locations.deleteLocation',
    () => withOrgScope((tx) => deleteLocationImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type DeleteLocationResult = Awaited<ReturnType<typeof deleteLocation>>;
