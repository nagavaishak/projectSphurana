import {
  phoneNumber,
  subscriptions,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import type { PhoneNumberListResult } from '../../models/phone-number.types.js';
import { getPlanPhoneNumberLimits } from '../../models/plan-limits.js';
import {
  type ListPhoneNumbersInput,
  listPhoneNumbersSchema,
} from './list-phone-numbers.schema.js';

const RELEASED_STATUSES = ['released', 'releasing'] as const;

const listPhoneNumbersImpl = async (
  db: DbConnection,
  input: ListPhoneNumbersInput
) => {
  const parsed = listPhoneNumbersSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, includeReleased } = parsed.data;

  try {
    const conditions = [eq(phoneNumber.organizationId, organizationId)];

    if (!includeReleased) {
      conditions.push(notInArray(phoneNumber.status, [...RELEASED_STATUSES]));
    }

    const items = await db.query.phoneNumber.findMany({
      where: and(...conditions),
      orderBy: [desc(phoneNumber.createdAt)],
    });

    // Get plan limits
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.organizationId, organizationId),
    });

    const planId = subscription?.planId ?? 'free';
    const limits = getPlanPhoneNumberLimits(planId);

    // Current count excludes released numbers
    const currentCount = includeReleased
      ? items.filter((n) => n.status !== 'released' && n.status !== 'releasing')
          .length
      : items.length;

    const result: PhoneNumberListResult = {
      items,
      maxAllowed: limits.maxPhoneNumbers,
      currentCount,
    };

    return ok(result);
  } catch (error) {
    logError('phoneNumbers.listPhoneNumbers', error, {
      feature: 'phone-numbers',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list phone numbers'
      )
    );
  }
};

export const listPhoneNumbers = (
  db: DbConnection,
  input: ListPhoneNumbersInput
) =>
  trackedResult(
    'phoneNumbers.listPhoneNumbers',
    () => withOrgScope((tx) => listPhoneNumbersImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ListPhoneNumbersResult = Awaited<
  ReturnType<typeof listPhoneNumbers>
>;
