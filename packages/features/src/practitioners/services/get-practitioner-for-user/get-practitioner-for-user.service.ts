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
  type GetPractitionerForUserInput,
  getPractitionerForUserSchema,
} from './get-practitioner-for-user.schema.js';

const getPractitionerForUserImpl = async (
  db: DbConnection,
  input: GetPractitionerForUserInput
): Promise<
  Result<
    NonNullable<Awaited<ReturnType<typeof db.query.practitioner.findFirst>>>
  >
> => {
  const parsed = getPractitionerForUserSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const result = await db.query.practitioner.findFirst({
    where: and(
      eq(practitioner.userId, parsed.data.userId),
      eq(practitioner.organizationId, parsed.data.organizationId),
      notDeleted(practitioner)
    ),
    // Narrow the joins to exactly what the /me view-model consumes. Selecting
    // the full rows leaked the entire calendar_account row — including
    // `encryptedCredentials` and sync tokens — to the browser, and shipped the
    // whole organization_service row for every linked service.
    with: {
      services: {
        columns: {},
        with: {
          service: {
            columns: { id: true, name: true },
          },
        },
      },
      calendarAccount: {
        columns: { id: true, email: true },
      },
    },
  });

  if (!result) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'No practitioner linked to this user'
      )
    );
  }

  return ok(result);
};

export const getPractitionerForUser = (
  db: DbConnection,
  input: GetPractitionerForUserInput
) =>
  trackedResult(
    'practitioners.getPractitionerForUser',
    () => withOrgScope((tx) => getPractitionerForUserImpl(tx, input), { db }),
    {
      properties: {
        userId: input.userId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetPractitionerForUserResult = Awaited<
  ReturnType<typeof getPractitionerForUser>
>;
