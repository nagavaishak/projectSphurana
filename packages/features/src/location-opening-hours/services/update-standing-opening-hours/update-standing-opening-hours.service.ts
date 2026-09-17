import {
  type LocationOpeningHours,
  type OrganizationLocation,
  organizationLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type UpdateStandingOpeningHoursInput,
  updateStandingOpeningHoursSchema,
} from './update-standing-opening-hours.schema.js';

const updateStandingOpeningHoursImpl = async (
  db: DbConnection,
  input: UpdateStandingOpeningHoursInput
): Promise<Result<OrganizationLocation>> => {
  const parsed = updateStandingOpeningHoursSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, locationId, openingHours } = parsed.data;

  const [result] = await db
    .update(organizationLocation)
    .set({
      openingHours: openingHours as LocationOpeningHours | null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(organizationLocation.id, locationId),
        eq(organizationLocation.organizationId, organizationId)
      )
    )
    .returning();

  if (!result) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found'));
  }

  return ok(result);
};

export const updateStandingOpeningHours = (
  db: DbConnection,
  input: UpdateStandingOpeningHoursInput
) =>
  trackedResult(
    'location-opening-hours.updateStanding',
    () =>
      withOrgScope((tx) => updateStandingOpeningHoursImpl(tx, input), { db }),
    {
      properties: {
        locationId: input.locationId,
        organizationId: input.organizationId,
      },
    }
  );

export type UpdateStandingOpeningHoursResult = Awaited<
  ReturnType<typeof updateStandingOpeningHours>
>;
