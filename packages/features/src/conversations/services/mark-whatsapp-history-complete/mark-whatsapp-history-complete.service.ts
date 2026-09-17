import { whatsappAccount } from '@borradh-workspace/database';
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
import {
  type MarkWhatsappHistoryCompleteInput,
  markWhatsappHistoryCompleteSchema,
} from './mark-whatsapp-history-complete.schema.js';

/**
 * Stamp `whatsapp_account.last_sync_at` when the Coexistence `history`
 * webhook signals completion (phase=2, progress=100).
 *
 * Used by the WhatsApp webhook controller so controllers stay out of the
 * ORM — and so we have a single place to track backfill completion for
 * reporting ("which accounts have been synced?" / "which need re-onboard?").
 */
const markWhatsappHistoryCompleteImpl = async (
  db: DbConnection,
  input: MarkWhatsappHistoryCompleteInput
): Promise<Result<{ stamped: boolean }>> => {
  const parsed = markWhatsappHistoryCompleteSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const updated = await db
      .update(whatsappAccount)
      .set({ lastSyncAt: new Date() })
      .where(eq(whatsappAccount.phoneNumberId, parsed.data.phoneNumberId))
      .returning({ id: whatsappAccount.id });

    if (!updated.length) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          `No whatsapp account for phone_number_id ${parsed.data.phoneNumberId}`
        )
      );
    }

    return ok({ stamped: true });
  } catch (error) {
    logError('conversations.markWhatsappHistoryComplete', error, {
      feature: 'conversations',
      extra: { phoneNumberId: parsed.data.phoneNumberId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to mark WhatsApp history complete'
      )
    );
  }
};

export const markWhatsappHistoryComplete = (
  db: DbConnection,
  input: MarkWhatsappHistoryCompleteInput
) =>
  trackedResult(
    'conversations.markWhatsappHistoryComplete',
    () => markWhatsappHistoryCompleteImpl(db, input),
    { properties: { phoneNumberId: input.phoneNumberId } }
  );

export type MarkWhatsappHistoryCompleteResult = Awaited<
  ReturnType<typeof markWhatsappHistoryComplete>
>;
