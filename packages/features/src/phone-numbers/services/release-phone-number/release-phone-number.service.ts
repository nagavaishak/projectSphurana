import { phoneNumber, withOrgScope } from '@borradh-workspace/database';
import { voiceEnv } from '@borradh-workspace/env/voice';
import { createTelnyxService } from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
  type ReleasePhoneNumberInput,
  releasePhoneNumberSchema,
} from './release-phone-number.schema.js';

const releasePhoneNumberImpl = async (
  db: DbConnection,
  input: ReleasePhoneNumberInput
): Promise<Result<{ success: true }>> => {
  const parsed = releasePhoneNumberSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  // Verify number belongs to this org
  const existing = await db.query.phoneNumber.findFirst({
    where: and(
      eq(phoneNumber.id, id),
      eq(phoneNumber.organizationId, organizationId)
    ),
  });

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Phone number not found')
    );
  }

  if (existing.status === 'released' || existing.status === 'releasing') {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Phone number is already released or being released'
      )
    );
  }

  // Mark as releasing
  await db
    .update(phoneNumber)
    .set({ status: 'releasing' })
    .where(eq(phoneNumber.id, id));

  try {
    // Release from Telnyx
    if (existing.providerNumberId && voiceEnv.TELNYX_API_KEY) {
      const telnyxService = createTelnyxService(voiceEnv.TELNYX_API_KEY);
      await telnyxService.releaseNumber(existing.providerNumberId);
    }

    // Mark as released (soft delete — voiceCall FK references preserved)
    await db
      .update(phoneNumber)
      .set({ status: 'released', supportsOutbound: false })
      .where(eq(phoneNumber.id, id));

    return ok({ success: true as const });
  } catch (error) {
    logError('phoneNumbers.releasePhoneNumber', error, {
      feature: 'phone-numbers',
      extra: { id, organizationId },
    });

    // Revert to previous status on failure
    await db
      .update(phoneNumber)
      .set({ status: existing.status })
      .where(eq(phoneNumber.id, id));

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to release phone number'
      )
    );
  }
};

export const releasePhoneNumber = (
  db: DbConnection,
  input: ReleasePhoneNumberInput
) =>
  trackedResult(
    'phoneNumbers.releasePhoneNumber',
    () => withOrgScope((tx) => releasePhoneNumberImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type ReleasePhoneNumberResult = Awaited<
  ReturnType<typeof releasePhoneNumber>
>;
