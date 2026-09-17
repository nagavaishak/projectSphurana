import {
  phoneNumber,
  voiceCall,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { SelectedPhoneNumber } from '../../models/index.js';
import {
  type SelectPhoneNumberInput,
  selectPhoneNumberSchema,
} from './select-phone-number.schema.js';

const selectPhoneNumberImpl = async (
  db: DbConnection,
  input: SelectPhoneNumberInput
): Promise<Result<SelectedPhoneNumber | null>> => {
  const parsed = selectPhoneNumberSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, leadId } = parsed.data;

  try {
    // 1. Lead affinity check: if leadId provided, find the last number used for this lead
    if (leadId) {
      const affinityResult = await db
        .select({
          id: phoneNumber.id,
          number: phoneNumber.number,
        })
        .from(voiceCall)
        .innerJoin(phoneNumber, eq(phoneNumber.id, voiceCall.phoneNumberId))
        .where(
          and(
            eq(voiceCall.leadId, leadId),
            isNotNull(voiceCall.phoneNumberId),
            eq(phoneNumber.status, 'active'),
            eq(phoneNumber.supportsOutbound, true)
          )
        )
        .orderBy(desc(voiceCall.createdAt))
        .limit(1);

      if (affinityResult.length > 0) {
        return ok({
          phoneNumberId: affinityResult[0].id,
          number: affinityResult[0].number,
        });
      }
    }

    // 2. Round-robin: select the number that was used least recently
    const roundRobinResult = await db
      .select({
        id: phoneNumber.id,
        number: phoneNumber.number,
      })
      .from(phoneNumber)
      .where(
        and(
          eq(phoneNumber.organizationId, organizationId),
          eq(phoneNumber.status, 'active'),
          eq(phoneNumber.supportsOutbound, true)
        )
      )
      .orderBy(asc(sql`${phoneNumber.lastUsedAt} NULLS FIRST`))
      .limit(1);

    if (roundRobinResult.length === 0) {
      // No pool numbers available — caller should fall back to global env var
      return ok(null);
    }

    const selected = roundRobinResult[0];

    // Update lastUsedAt for round-robin rotation
    await db
      .update(phoneNumber)
      .set({ lastUsedAt: new Date() })
      .where(eq(phoneNumber.id, selected.id));

    return ok({
      phoneNumberId: selected.id,
      number: selected.number,
    });
  } catch (error) {
    logError('phoneNumbers.selectPhoneNumber', error, {
      feature: 'phone-numbers',
      extra: { organizationId, leadId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to select phone number'
      )
    );
  }
};

export const selectPhoneNumber = (
  db: DbConnection,
  input: SelectPhoneNumberInput
) =>
  trackedResult(
    'phoneNumbers.selectPhoneNumber',
    () => withOrgScope((tx) => selectPhoneNumberImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        leadId: input.leadId,
      },
    }
  );

export type SelectPhoneNumberResult = Awaited<
  ReturnType<typeof selectPhoneNumber>
>;
