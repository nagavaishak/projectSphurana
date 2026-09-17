import { type OrgSmsNumber, orgSmsNumber } from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
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
  type GetSmsNumberInput,
  getSmsNumberSchema,
} from './get-sms-number.schema.js';

/**
 * The org's campaign SMS sender number (`org_sms_number`), or null if none is
 * provisioned. Powers the "SMS sending" setup card + the launch pre-flight's
 * user-facing guidance. Org-scoped read.
 */
const getSmsNumberImpl = async (
  db: DbConnection,
  input: GetSmsNumberInput
): Promise<Result<OrgSmsNumber | null>> => {
  const parsed = getSmsNumberSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const row = await withOrgScope(
    (tx) =>
      tx.query.orgSmsNumber.findFirst({
        where: eq(orgSmsNumber.organizationId, parsed.data.organizationId),
      }),
    { db }
  );

  return ok(row ?? null);
};

export const getSmsNumber = (db: DbConnection, input: GetSmsNumberInput) =>
  trackedResult('campaigns.getSmsNumber', () => getSmsNumberImpl(db, input), {
    properties: { organizationId: input.organizationId },
    internalErrorsOnly: true,
  });

export type GetSmsNumberResult = Awaited<ReturnType<typeof getSmsNumber>>;
