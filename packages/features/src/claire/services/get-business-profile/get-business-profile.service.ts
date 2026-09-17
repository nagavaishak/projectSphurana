import {
  type BusinessProfile,
  businessProfile,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetBusinessProfileInput,
  getBusinessProfileSchema,
} from './get-business-profile.schema.js';

const getBusinessProfileImpl = async (
  db: DbConnection,
  input: GetBusinessProfileInput
): Promise<Result<BusinessProfile>> => {
  const parsed = getBusinessProfileSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const row = await db.query.businessProfile.findFirst({
    where: eq(businessProfile.organizationId, parsed.data.organizationId),
  });

  if (!row) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Business profile not found')
    );
  }

  return ok(row);
};

export const getBusinessProfile = (
  db: DbConnection,
  input: GetBusinessProfileInput
) =>
  trackedResult(
    'claire.getBusinessProfile',
    () => getBusinessProfileImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetBusinessProfileResult = Awaited<
  ReturnType<typeof getBusinessProfile>
>;
