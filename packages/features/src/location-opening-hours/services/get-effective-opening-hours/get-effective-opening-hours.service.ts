import {
  type LocationOpeningHours,
  type OrganizationLocationOpeningHoursException,
  organization,
  organizationLocation,
  organizationLocationOpeningHoursException,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, between, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type GetEffectiveOpeningHoursInput,
  getEffectiveOpeningHoursSchema,
} from './get-effective-opening-hours.schema.js';

export interface LocationScheduleResult {
  locationId: string;
  /**
   * Standing weekly schedule for the location. Null = inherits org businessHours.
   */
  openingHours: LocationOpeningHours | null;
  /**
   * Fallback weekly schedule from the organization (used when location.openingHours is null).
   */
  organizationDefault: LocationOpeningHours | null;
  /**
   * Per-date overrides within [windowStart, windowEnd].
   * `date` is YYYY-MM-DD; for `closed=false`, fromMinutes/toMinutes are populated.
   */
  exceptions: OrganizationLocationOpeningHoursException[];
}

const toDateString = (d: Date): string => {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const getEffectiveOpeningHoursImpl = async (
  db: DbConnection,
  input: GetEffectiveOpeningHoursInput
): Promise<Result<LocationScheduleResult>> => {
  const parsed = getEffectiveOpeningHoursSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, locationId, windowStart, windowEnd } = parsed.data;

  const [location] = await db
    .select()
    .from(organizationLocation)
    .where(
      and(
        eq(organizationLocation.id, locationId),
        eq(organizationLocation.organizationId, organizationId)
      )
    )
    .limit(1);

  if (!location) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found'));
  }

  const [org] = await db
    .select({ businessHours: organization.businessHours })
    .from(organization)
    .where(and(eq(organization.id, organizationId), notDeleted(organization)))
    .limit(1);

  const exceptions = await db
    .select()
    .from(organizationLocationOpeningHoursException)
    .where(
      and(
        eq(organizationLocationOpeningHoursException.locationId, locationId),
        between(
          organizationLocationOpeningHoursException.date,
          toDateString(windowStart),
          toDateString(windowEnd)
        )
      )
    );

  return ok({
    locationId,
    openingHours: location.openingHours ?? null,
    organizationDefault:
      (org?.businessHours as LocationOpeningHours | null) ?? null,
    exceptions,
  });
};

export const getEffectiveOpeningHours = (
  db: DbConnection,
  input: GetEffectiveOpeningHoursInput
) =>
  trackedResult(
    'location-opening-hours.getEffective',
    () => withOrgScope((tx) => getEffectiveOpeningHoursImpl(tx, input), { db }),
    {
      properties: {
        locationId: input.locationId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetEffectiveOpeningHoursResult = Awaited<
  ReturnType<typeof getEffectiveOpeningHours>
>;
