import { type LeadStatus, lead } from '@borradh-workspace/database';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';

import type { DbConnection } from '../../../shared/index.js';

export interface AdvanceLeadStageInput {
  leadId: string;
  /** Only advance when the lead is currently in this stage. */
  from: LeadStatus;
  to: LeadStatus;
}

/**
 * Move a lead forward through the pipeline as a side effect of something that
 * actually happened (Claire made contact, the lead replied, the follow-ups ran
 * out).
 *
 * **It only ever advances.** The update is conditional on the lead still being
 * in the `from` stage, so a status a human has already moved on — someone
 * marked `won`, or manually parked as `lost` — is never dragged backwards by an
 * automated event arriving late. That guard is in the WHERE clause rather than
 * a read-then-write, so two concurrent events cannot both win.
 *
 * Best-effort: a stage that fails to move is a reporting inaccuracy, not a
 * reason to fail the message that triggered it.
 */
export async function advanceLeadStage(
  db: DbConnection,
  input: AdvanceLeadStageInput
): Promise<void> {
  try {
    await db
      .update(lead)
      .set({ status: input.to, updatedAt: new Date() })
      .where(and(eq(lead.id, input.leadId), eq(lead.status, input.from)));
  } catch (error) {
    logError('leads.advanceLeadStage', error, {
      feature: 'leads',
      extra: { leadId: input.leadId, from: input.from, to: input.to },
    });
  }
}
