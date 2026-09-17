import { suppression, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import { normalizeContact } from '../_shared/channel-eligibility.js';
import {
  type RecordSuppressionInput,
  recordSuppressionSchema,
} from './record-suppression.schema.js';

/**
 * Add a contact to the org's suppression list. Idempotent (ON CONFLICT DO
 * NOTHING on the org+channel+contact unique). Contact is normalized so opt-outs
 * match regardless of formatting, and persists even if the lead is later
 * deleted (suppression is keyed by contact, not leadId).
 */
const recordSuppressionImpl = async (
  db: DbConnection,
  input: RecordSuppressionInput
) => {
  const parsed = recordSuppressionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, channel, reason, source } = parsed.data;
  const contact = normalizeContact(channel, parsed.data.contact);

  await db
    .insert(suppression)
    .values({
      organizationId,
      channel,
      contact,
      reason,
      source: source ?? null,
    })
    .onConflictDoNothing();

  return ok({ suppressed: true, contact });
};

export const recordSuppression = (
  db: DbConnection,
  input: RecordSuppressionInput
) =>
  trackedResult(
    'campaigns.recordSuppression',
    () => withOrgScope((tx) => recordSuppressionImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        channel: input.channel,
      },
    }
  );

export type RecordSuppressionResult = Awaited<
  ReturnType<typeof recordSuppression>
>;
