import {
  membershipPlan,
  membershipPlanLocation,
  offer,
  offerLocation,
  organizationService,
  organizationServiceLocation,
  practitioner,
  practitionerLocation,
  product,
  productLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { assertLocationsBelongToOrg } from '../assert-locations-belong-to-org/index.js';
import {
  type ApplyLocationCatalogInput,
  type LocationCatalogCounts,
  applyLocationCatalogSchema,
} from './apply-location-catalog.schema.js';

/**
 * One descriptor per join table, so the five entity kinds are handled by one
 * loop rather than five near-identical blocks. Adding a sixth kind is a row
 * here, which is also the only way a new kind cannot quietly skip the
 * cross-tenant ownership check below.
 *
 * A FUNCTION, not a module-level const, and that matters. Every row reads a
 * COLUMN off a drizzle table (`practitionerLocation.practitionerId`), so a
 * const would dereference the `@borradh-workspace/database` barrel at import
 * time. Any consumer that loads this module before that barrel has finished
 * initialising — which is every jest suite in `apps/api`, where the barrel
 * cannot load at all — gets `Cannot read properties of undefined (reading
 * 'practitionerId')`, thrown from a service the suite never meant to touch.
 * Building the rows on call keeps the import side-effect-free.
 */
const kinds = () =>
  [
    {
      key: 'practitioners',
      join: practitionerLocation,
      joinOwner: practitionerLocation.practitionerId,
      entity: practitioner,
      entityId: practitioner.id,
      entityOrg: practitioner.organizationId,
      label: 'practitioner',
      ownerField: 'practitionerId',
    },
    {
      key: 'services',
      join: organizationServiceLocation,
      joinOwner: organizationServiceLocation.serviceId,
      entity: organizationService,
      entityId: organizationService.id,
      entityOrg: organizationService.organizationId,
      label: 'service',
      ownerField: 'serviceId',
    },
    {
      key: 'products',
      join: productLocation,
      joinOwner: productLocation.productId,
      entity: product,
      entityId: product.id,
      entityOrg: product.organizationId,
      label: 'product',
      ownerField: 'productId',
    },
    {
      key: 'membershipPlans',
      join: membershipPlanLocation,
      joinOwner: membershipPlanLocation.planId,
      entity: membershipPlan,
      entityId: membershipPlan.id,
      entityOrg: membershipPlan.organizationId,
      label: 'membership plan',
      ownerField: 'planId',
    },
    {
      key: 'offers',
      join: offerLocation,
      joinOwner: offerLocation.offerId,
      entity: offer,
      entityId: offer.id,
      entityOrg: offer.organizationId,
      label: 'promotion',
      ownerField: 'offerId',
    },
  ] as const;

type KindKey = ReturnType<typeof kinds>[number]['key'];

/** Which request field feeds which kind. */
const REQUEST_FIELD: Record<KindKey, keyof ApplyLocationCatalogInput> = {
  practitioners: 'practitionerIds',
  services: 'serviceIds',
  products: 'productIds',
  membershipPlans: 'membershipPlanIds',
  offers: 'offerIds',
};

const emptyCounts = (): LocationCatalogCounts => ({
  practitioners: 0,
  services: 0,
  products: 0,
  membershipPlans: 0,
  offers: 0,
});

/**
 * Set which catalogue entities are EXPLICITLY assigned to one branch.
 *
 * THE INVARIANT: every write is scoped to `locationId`. Rows belonging to any
 * other branch are never read, written or deleted — so editing Cork can never
 * change what Dublin offers. That is the property the tests pin, and the one a
 * future "just replace them all" refactor would break.
 *
 * Within this branch the semantics are REPLACE, because that is what an edit
 * screen means by a ticked list: ids present are assigned, ids absent are not.
 * An ABSENT REQUEST FIELD is different from an empty array — absent means
 * "leave this kind alone" (the create path sends only what was picked), while
 * `[]` means "this branch explicitly assigns none of them".
 *
 * The sharp edge worth knowing, and the reason the pickers carry a warning:
 * zero join rows across the WHOLE table means "available at every branch"
 * (`atLocationOrUnassigned`). So removing an entity's last remaining row does
 * not make it unavailable — it makes it available everywhere. That is inherent
 * to the encoding, not to this service.
 *
 * Exported as the IMPL (taking a `db`/`tx`) as well as the wrapped export,
 * because `createLocation` composes it INTO its own transaction: the location
 * row and its catalogue must commit together or not at all. Wrapping it there
 * would open a second scoped transaction and lose that.
 */
export const applyLocationCatalogImpl = async (
  db: DbConnection,
  input: ApplyLocationCatalogInput
): Promise<Result<{ locationId: string; applied: LocationCatalogCounts }>> => {
  const parsed = applyLocationCatalogSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { locationId, organizationId, copyFromLocationId } = parsed.data;

  // Both the target and the copy source arrive from the request body, so both
  // are attacker-controlled — see `assertLocationsBelongToOrg`.
  const ownedLocations = await assertLocationsBelongToOrg(db, {
    organizationId,
    locationIds: copyFromLocationId
      ? [locationId, copyFromLocationId]
      : [locationId],
  });
  if (!ownedLocations.success) return err(ownedLocations.error);

  if (copyFromLocationId === locationId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Cannot copy a location from itself'
      )
    );
  }

  const applied = emptyCounts();

  try {
    for (const kind of kinds()) {
      const requested = parsed.data[REQUEST_FIELD[kind.key]] as
        | string[]
        | undefined;

      // Absent AND nothing to copy → this kind was not part of the request at
      // all, so leave the branch's existing rows exactly as they are.
      if (requested === undefined && !copyFromLocationId) continue;

      // Copying takes the source branch's EXPLICIT rows only. There is nothing
      // to copy for an entity the source inherits implicitly — the target
      // already has it, and materialising a row would restrict it.
      const copied = copyFromLocationId
        ? (
            await db
              .select({ ownerId: kind.joinOwner })
              .from(kind.join)
              .where(eq(kind.join.locationId, copyFromLocationId))
          ).map((row) => row.ownerId)
        : [];

      const ids = [...new Set([...(requested ?? []), ...copied])];

      if (ids.length > 0) {
        // Every id must belong to the caller's org. A cross-tenant join row
        // would surface another org's service inside this catalogue, so this is
        // a hard failure rather than a filter-and-continue.
        const owned = await db
          .select({ id: kind.entityId })
          .from(kind.entity)
          .where(
            and(inArray(kind.entityId, ids), eq(kind.entityOrg, organizationId))
          );

        if (owned.length !== ids.length) {
          return err(
            new FeatureError(
              ErrorCodes.VALIDATION_ERROR,
              `One or more ${kind.label}s not found`
            )
          );
        }
      }

      // Drop what this branch no longer assigns. BOTH predicates matter: the
      // locationId clause is the invariant (another branch's rows are not ours
      // to touch), and the notInArray clause keeps the rows that survive, so
      // their ids and createdAt are not churned on every save.
      await db
        .delete(kind.join)
        .where(
          ids.length > 0
            ? and(
                eq(kind.join.locationId, locationId),
                notInArray(kind.joinOwner, ids)
              )
            : eq(kind.join.locationId, locationId)
        );

      if (ids.length === 0) continue;

      const inserted = await db
        .insert(kind.join)
        .values(
          ids.map((id) => ({ [kind.ownerField]: id, locationId })) as never
        )
        .onConflictDoNothing()
        .returning({ id: kind.join.id });

      applied[kind.key] = inserted.length;
    }

    return ok({ locationId, applied });
  } catch (error) {
    logError('organizationLocations.applyLocationCatalog', error, {
      feature: 'organization-locations',
      extra: { locationId, organizationId, copyFromLocationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to set the location's catalogue"
      )
    );
  }
};

export const applyLocationCatalog = (
  db: DbConnection,
  input: ApplyLocationCatalogInput
) =>
  trackedResult(
    'organizationLocations.applyLocationCatalog',
    () => withOrgScope((tx) => applyLocationCatalogImpl(tx, input), { db }),
    { properties: { locationId: input.locationId } }
  );

export type ApplyLocationCatalogResult = Awaited<
  ReturnType<typeof applyLocationCatalog>
>;
