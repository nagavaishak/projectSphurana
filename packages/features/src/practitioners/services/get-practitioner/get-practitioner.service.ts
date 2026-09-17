import { practitioner, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
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
  type GetPractitionerInput,
  getPractitionerSchema,
} from './get-practitioner.schema.js';

const getPractitionerImpl = async (
  db: DbConnection,
  input: GetPractitionerInput
): Promise<
  Result<
    NonNullable<Awaited<ReturnType<typeof db.query.practitioner.findFirst>>>
  >
> => {
  const parsed = getPractitionerSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const result = await db.query.practitioner.findFirst({
    where: and(
      eq(practitioner.id, parsed.data.id),
      eq(practitioner.organizationId, parsed.data.organizationId),
      notDeleted(practitioner)
    ),
    with: {
      locations: {
        with: {
          location: true,
        },
      },
      services: {
        with: {
          service: true,
        },
      },
      calendarAccount: true,
    },
  });

  if (!result) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Practitioner not found')
    );
  }

  return ok(result);
};

export const getPractitioner = (
  db: DbConnection,
  input: GetPractitionerInput
) =>
  trackedResult(
    'practitioners.getPractitioner',
    () => withOrgScope((tx) => getPractitionerImpl(tx, input), { db }),
    {
      properties: { id: input.id },
      internalErrorsOnly: true,
    }
  );

export type GetPractitionerResult = Awaited<ReturnType<typeof getPractitioner>>;
