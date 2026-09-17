import {
  organizationLocation,
  organizationLocationOpeningHoursException,
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
  type DeleteOpeningHoursExceptionInput,
  deleteOpeningHoursExceptionSchema,
} from './delete-opening-hours-exception.schema.js';

const deleteOpeningHoursExceptionImpl = async (
  db: DbConnection,
  input: DeleteOpeningHoursExceptionInput
): Promise<Result<{ deleted: boolean }>> => {
  const parsed = deleteOpeningHoursExceptionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, locationId, date } = parsed.data;

  const [location] = await db
    .select({ id: organizationLocation.id })
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

  const result = await db
    .delete(organizationLocationOpeningHoursException)
    .where(
      and(
        eq(organizationLocationOpeningHoursException.locationId, locationId),
        eq(organizationLocationOpeningHoursException.date, date)
      )
    )
    .returning({ id: organizationLocationOpeningHoursException.id });

  return ok({ deleted: result.length > 0 });
};

export const deleteOpeningHoursException = (
  db: DbConnection,
  input: DeleteOpeningHoursExceptionInput
) =>
  trackedResult(
    'location-opening-hours.deleteException',
    () =>
      withOrgScope((tx) => deleteOpeningHoursExceptionImpl(tx, input), { db }),
    {
      properties: {
        locationId: input.locationId,
        date: input.date,
        organizationId: input.organizationId,
      },
    }
  );

export type DeleteOpeningHoursExceptionResult = Awaited<
  ReturnType<typeof deleteOpeningHoursException>
>;
