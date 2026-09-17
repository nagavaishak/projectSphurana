import { type OrgSmsNumber, orgSmsNumber } from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { SmsNumberProvider } from '../_shared/sms-number-provider.js';
import {
  type ProvisionSmsNumberInput,
  provisionSmsNumberSchema,
} from './provision-sms-number.schema.js';

/**
 * Buy a Twilio number for an org and record it as the org's active campaign
 * SMS sender (`org_sms_number`). THIS COSTS MONEY — the API/UI must gate it
 * behind explicit user confirmation.
 *
 * Idempotent w.r.t. the Twilio account: if the number is ALREADY owned it's
 * attached for free (no second purchase); only a genuinely new number is bought.
 *
 * One number per org (unique constraint): if a prior row exists (e.g. a
 * `failed`/`released` attempt) it's overwritten; an already-`active` number is
 * left untouched and returned as ALREADY_EXISTS so we never double-buy.
 *
 * Any purchase happens BEFORE the DB write, so it runs outside the org
 * transaction — a DB failure after a successful buy is logged loudly rather
 * than silently orphaning a paid number.
 */
const provisionSmsNumberImpl = async (
  db: DbConnection,
  input: ProvisionSmsNumberInput,
  provider: SmsNumberProvider
): Promise<Result<OrgSmsNumber>> => {
  const parsed = provisionSmsNumberSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, phoneNumber, country, smsWebhookUrl } = parsed.data;

  // Guard against double-buy: only one number per org.
  const existing = await withOrgScope(
    (tx) =>
      tx.query.orgSmsNumber.findFirst({
        where: eq(orgSmsNumber.organizationId, organizationId),
      }),
    { db }
  );
  if (existing && existing.status === 'active') {
    return err(
      new FeatureError(
        ErrorCodes.ALREADY_EXISTS,
        'This organization already has an active SMS number'
      )
    );
  }

  // Attach if we already own it (free); otherwise buy it (money-spending).
  let provisioned: { sid: string; phoneNumber: string };
  try {
    const owned = await provider.listOwnedNumbers();
    const already = owned.find((n) => n.phoneNumber === phoneNumber);
    provisioned =
      already ??
      (await provider.provisionNumber({
        phoneNumber,
        friendlyName: `Borradh Campaigns (${country})`,
        smsWebhookUrl,
      }));
  } catch (error) {
    logError('campaigns.provisionSmsNumber.buy', error, {
      feature: 'campaigns',
      extra: { organizationId, phoneNumber, country },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        error instanceof Error
          ? `Could not set up the number: ${error.message}`
          : 'Could not set up the number'
      )
    );
  }

  const values = {
    organizationId,
    phoneNumber: provisioned.phoneNumber,
    twilioSid: provisioned.sid,
    country,
    status: 'active' as const,
    provisionedAt: new Date(),
  };

  try {
    const row = await withOrgScope(
      async (tx) => {
        if (existing) {
          const [updated] = await tx
            .update(orgSmsNumber)
            .set(values)
            .where(eq(orgSmsNumber.id, existing.id))
            .returning();
          return updated;
        }
        const [inserted] = await tx
          .insert(orgSmsNumber)
          .values(values)
          .returning();
        return inserted;
      },
      { db }
    );

    return ok(row);
  } catch (error) {
    // The number is bought but we couldn't persist it — surface loudly so it
    // can be reconciled (Twilio SID is in the log) rather than lost.
    logError('campaigns.provisionSmsNumber.persist', error, {
      feature: 'campaigns',
      extra: { organizationId, twilioSid: provisioned.sid, phoneNumber },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Bought the number but failed to save it — contact support'
      )
    );
  }
};

export const provisionSmsNumber = (
  db: DbConnection,
  input: ProvisionSmsNumberInput,
  provider: SmsNumberProvider
) =>
  trackedResult(
    'campaigns.provisionSmsNumber',
    () => provisionSmsNumberImpl(db, input, provider),
    { properties: { organizationId: input.organizationId } }
  );

export type ProvisionSmsNumberResult = Awaited<
  ReturnType<typeof provisionSmsNumber>
>;
