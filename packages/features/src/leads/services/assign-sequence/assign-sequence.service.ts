import { lead, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type AssignSequenceInput,
  assignSequenceSchema,
} from './assign-sequence.schema.js';

/**
 * Internal implementation of assign sequence to lead
 */
const assignSequenceImpl = async (
  db: DbConnection,
  input: AssignSequenceInput
): Promise<Result<typeof result>> => {
  // Validate input
  const parsed = assignSequenceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Check if lead exists
  const existingLead = await db.query.lead.findFirst({
    where: (lead, { eq, and, isNull }) =>
      and(
        eq(lead.id, parsed.data.leadId),
        eq(lead.organizationId, parsed.data.organizationId),
        isNull(lead.deletedAt)
      ),
  });

  if (!existingLead) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Lead with ID ${parsed.data.leadId} not found`,
        { leadId: parsed.data.leadId }
      )
    );
  }

  // Check if sequence exists
  const existingSequence = await db.query.sequence.findFirst({
    where: (sequence, { eq, and, isNull }) =>
      and(
        eq(sequence.id, parsed.data.sequenceId),
        eq(sequence.organizationId, parsed.data.organizationId),
        isNull(sequence.deletedAt)
      ),
  });

  if (!existingSequence) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Sequence with ID ${parsed.data.sequenceId} not found`,
        { sequenceId: parsed.data.sequenceId }
      )
    );
  }

  // Check if sequence is active
  if (!existingSequence.isActive) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Cannot assign inactive sequence to lead',
        { sequenceId: parsed.data.sequenceId }
      )
    );
  }

  // Assign sequence to lead
  const [result] = await db
    .update(lead)
    .set({
      sequenceId: parsed.data.sequenceId,
      sequenceStatus: 'active',
      sequenceStartedAt: new Date(),
      currentStepId: null,
      nextActionAt: new Date(), // Will be calculated by sequence executor
    })
    .where(
      and(
        eq(lead.id, parsed.data.leadId),
        eq(lead.organizationId, parsed.data.organizationId),
        notDeleted(lead)
      )
    )
    .returning();

  return ok(result);
};

/**
 * Assign a sequence to a lead
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Assign sequence input
 * @returns Result with updated lead or error
 *
 * @example
 * ```ts
 * const result = await assignSequence(db, {
 *   leadId: 'lead_123',
 *   sequenceId: 'seq_123',
 *   organizationId: 'org_123',
 * });
 * ```
 */
export const assignSequence = (db: DbConnection, input: AssignSequenceInput) =>
  trackedResult(
    'leads.assignSequence',
    () => withOrgScope((tx) => assignSequenceImpl(tx, input), { db }),
    { properties: { leadId: input.leadId, sequenceId: input.sequenceId } }
  );

/**
 * Result type for assignSequence
 */
export type AssignSequenceResult = Awaited<ReturnType<typeof assignSequence>>;
