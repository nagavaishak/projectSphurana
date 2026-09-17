import {
  organizationService,
  organizationServiceLocation,
  organizationServiceVariant,
  organizationServiceVariantLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import { assertLocationsBelongToOrg } from '../../../organization-locations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type AssignServiceLocationsInput,
  type ServiceLocationAssignment,
  assignServiceLocationsSchema,
} from './assign-service-locations.schema.js';

/**
 * Replace which branches offer a service, and at what price.
 *
 * THE ONE THING TO KNOW: **an empty `locations` array means "offered at every
 * branch", not "offered nowhere."** Zero join rows is the "everywhere" default
 * the entire read path is built on (`atLocationOrUnassigned`), and it is the
 * only convention under which these tables could ship EMPTY without blanking
 * every catalogue in production on the day branch filtering switched on. So
 * `[]` is how an owner undoes a per-branch restriction. "Available nowhere" is
 * not a state this table expresses — `isActive: false` is.
 *
 * A full REPLACE rather than a merge, matching `assignPractitionerLocations`:
 * the editor sends the whole set it wants, so removing a branch is expressible
 * without a second endpoint.
 */
const assignServiceLocationsImpl = async (
  db: DbConnection,
  input: AssignServiceLocationsInput
): Promise<
  Result<{ serviceId: string; locations: ServiceLocationAssignment[] }>
> => {
  const parsed = assignServiceLocationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { serviceId, organizationId, locations } = parsed.data;

  const existing = await db.query.organizationService.findFirst({
    where: and(
      eq(organizationService.id, serviceId),
      eq(organizationService.organizationId, organizationId)
    ),
    columns: { id: true },
  });

  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found'));
  }

  // The branch ids come from the request body — see the note on
  // `assertLocationsBelongToOrg` for why this is a hard failure.
  const owned = await assertLocationsBelongToOrg(db, {
    organizationId,
    locationIds: locations.map((l) => l.locationId),
  });
  if (!owned.success) return err(owned.error);

  try {
    await db
      .delete(organizationServiceLocation)
      .where(eq(organizationServiceLocation.serviceId, serviceId));

    // Variant prices for this service's branches. Replaced wholesale for the
    // branches named in this call, and only those — a branch absent from the
    // body keeps whatever it had, matching how the service-level rows behave.
    const withVariants = locations.filter((l) => l.variantOverrides);
    if (withVariants.length > 0) {
      // Every variantId must belong to THIS service. Without the check a
      // caller could price another service's variant — and because the read
      // path keys purely on variantId, that price would surface in the other
      // service's catalogue at this branch.
      const ownVariants = await db.query.organizationServiceVariant.findMany({
        where: eq(organizationServiceVariant.serviceId, serviceId),
        columns: { id: true },
      });
      const ownIds = new Set(ownVariants.map((v) => v.id));
      const foreign = withVariants
        .flatMap((l) => l.variantOverrides ?? [])
        .filter((v) => !ownIds.has(v.variantId));
      if (foreign.length > 0) {
        return err(
          new FeatureError(
            ErrorCodes.VALIDATION_ERROR,
            'One or more variants do not belong to this service'
          )
        );
      }

      await db.delete(organizationServiceVariantLocation).where(
        and(
          eq(organizationServiceVariantLocation.serviceId, serviceId),
          inArray(
            organizationServiceVariantLocation.locationId,
            withVariants.map((l) => l.locationId)
          )
        )
      );

      const variantRows = withVariants.flatMap((l) =>
        (l.variantOverrides ?? []).map((v) => ({
          variantId: v.variantId,
          // Derived from the service under edit, never taken from the caller —
          // it is an RLS routing column and must not be spoofable.
          serviceId,
          locationId: l.locationId,
          priceCentsOverride: v.priceCentsOverride,
        }))
      );
      if (variantRows.length > 0) {
        await db.insert(organizationServiceVariantLocation).values(variantRows);
      }
    }

    if (locations.length > 0) {
      await db.insert(organizationServiceLocation).values(
        locations.map(
          ({ locationId, priceCentsOverride, durationMinutesOverride }) => ({
            serviceId,
            locationId,
            // `?? null` and not `|| null`: a legitimate 0 price override (a
            // branch that gives this away free) must survive.
            priceCentsOverride: priceCentsOverride ?? null,
            durationMinutesOverride: durationMinutesOverride ?? null,
          })
        )
      );
    }

    return ok({ serviceId, locations });
  } catch (error) {
    logError('organizationServices.assignServiceLocations', error, {
      feature: 'organization-services',
      extra: { serviceId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to assign service locations'
      )
    );
  }
};

export const assignServiceLocations = (
  db: DbConnection,
  input: AssignServiceLocationsInput
) =>
  trackedResult(
    'organizationServices.assignServiceLocations',
    () => withOrgScope((tx) => assignServiceLocationsImpl(tx, input), { db }),
    { properties: { serviceId: input.serviceId } }
  );

export type AssignServiceLocationsResult = Awaited<
  ReturnType<typeof assignServiceLocations>
>;
