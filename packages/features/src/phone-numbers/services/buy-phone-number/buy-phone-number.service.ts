import { randomUUID } from 'node:crypto';
import {
  type PhoneNumber,
  phoneNumber,
  subscriptions,
  withOrgScope,
} from '@borradh-workspace/database';
import { voiceEnv } from '@borradh-workspace/env/voice';
import { createTelnyxService } from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, notInArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getPlanPhoneNumberLimits } from '../../models/plan-limits.js';
import {
  type BuyPhoneNumberInput,
  buyPhoneNumberSchema,
} from './buy-phone-number.schema.js';

const RELEASED_STATUSES = ['released', 'releasing'] as const;

const buyPhoneNumberImpl = async (
  db: DbConnection,
  input: BuyPhoneNumberInput
): Promise<Result<PhoneNumber>> => {
  const parsed = buyPhoneNumberSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    phoneNumber: phoneNumberToBuy,
    label,
    countryCode,
  } = parsed.data;

  // Check Telnyx API key is configured
  if (!voiceEnv.TELNYX_API_KEY) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Phone number provisioning is not configured'
      )
    );
  }

  // Check plan limits
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  const planId = subscription?.planId ?? 'free';
  const limits = getPlanPhoneNumberLimits(planId);

  if (!limits.canBuyNumbers) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        'Your plan does not allow purchasing phone numbers. Please upgrade.'
      )
    );
  }

  // Count current non-released numbers
  const currentNumbers = await db
    .select({ id: phoneNumber.id })
    .from(phoneNumber)
    .where(
      and(
        eq(phoneNumber.organizationId, organizationId),
        notInArray(phoneNumber.status, [...RELEASED_STATUSES])
      )
    );

  if (currentNumbers.length >= limits.maxPhoneNumbers) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        `Your plan allows a maximum of ${limits.maxPhoneNumbers} phone numbers. You currently have ${currentNumbers.length}.`
      )
    );
  }

  try {
    // 1. Buy number from Telnyx
    const telnyxService = createTelnyxService(voiceEnv.TELNYX_API_KEY);
    const order = await telnyxService.buyNumber(phoneNumberToBuy);

    const providerNumberId = order.phone_numbers[0]?.id ?? null;

    // 2. Insert record — Telnyx numbers are active immediately (no SIP trunk needed)
    const id = randomUUID();
    const [result] = await db
      .insert(phoneNumber)
      .values({
        id,
        organizationId,
        number: phoneNumberToBuy,
        label: label ?? null,
        provider: 'telnyx',
        providerNumberId,
        status: 'active',
        supportsOutbound: true,
        countryCode: countryCode ?? null,
      })
      .returning();

    return ok(result);
  } catch (error) {
    logError('phoneNumbers.buyPhoneNumber', error, {
      feature: 'phone-numbers',
      extra: { organizationId, phoneNumber: phoneNumberToBuy },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to buy phone number')
    );
  }
};

export const buyPhoneNumber = (db: DbConnection, input: BuyPhoneNumberInput) =>
  trackedResult(
    'phoneNumbers.buyPhoneNumber',
    () => withOrgScope((tx) => buyPhoneNumberImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        phoneNumber: input.phoneNumber,
      },
    }
  );

export type BuyPhoneNumberResult = Awaited<ReturnType<typeof buyPhoneNumber>>;
