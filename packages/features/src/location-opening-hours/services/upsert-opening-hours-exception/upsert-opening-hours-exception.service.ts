import {
  type OrganizationLocationOpeningHoursException,
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
  type UpsertOpeningHoursExceptionInput,
  upsertOpeningHoursExceptionSchema,
} from './upsert-opening-hours-exception.schema.js';

const upsertOpeningHoursExceptionImpl = async (
  db: DbConnection,
  input: UpsertOpeningHoursExceptionInput
): Promise<Result<OrganizationLocationOpeningHoursException>> => {
  const parsed = upsertOpeningHoursExceptionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    locationId,
    date,
    closed,
    fromMinutes,
    toMinutes,
    note,
    createdById,
  } = parsed.data;

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

  const values = {
    locationId,
    date,
    closed,
    fromMinutes: closed ? null : (fromMinutes ?? null),
    toMinutes: closed ? null : (toMinutes ?? null),
    note: note ?? null,
    createdById,
  };

  const [result] = await db
    .insert(organizationLocationOpeningHoursException)
    .values(values)
    .onConflictDoUpdate({
      target: [
        organizationLocationOpeningHoursException.locationId,
        organizationLocationOpeningHoursException.date,
      ],
      set: {
        closed: values.closed,
        fromMinutes: values.fromMinutes,
        toMinutes: values.toMinutes,
        note: values.note,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!result) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to upsert opening-hours exception'
      )
    );
  }

  return ok(result);
};

export const upsertOpeningHoursException = (
  db: DbConnection,
  input: UpsertOpeningHoursExceptionInput
) =>
  trackedResult(
    'location-opening-hours.upsertException',
    () =>
      withOrgScope((tx) => upsertOpeningHoursExceptionImpl(tx, input), { db }),
    {
      properties: {
        locationId: input.locationId,
        date: input.date,
        organizationId: input.organizationId,
      },
    }
  );

export type UpsertOpeningHoursExceptionResult = Awaited<
  ReturnType<typeof upsertOpeningHoursException>
>;
