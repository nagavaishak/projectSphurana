import { sequence } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateSequenceInput,
  createSequenceSchema,
} from './create-sequence.schema.js';

/**
 * Internal implementation of create sequence
 */
const createSequenceImpl = async (
  db: DbConnection,
  input: CreateSequenceInput
): Promise<Result<typeof result>> => {
  // Validate input
  const parsed = createSequenceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Create sequence
  const [result] = await db
    .insert(sequence)
    .values({
      organizationId: parsed.data.organizationId,
      name: parsed.data.name,
      description: parsed.data.description,
      isActive: parsed.data.isActive,
      triggerOnNewLead: parsed.data.triggerOnNewLead,
      scheduleNextDay: parsed.data.scheduleNextDay,
      nodes: parsed.data.nodes,
      edges: parsed.data.edges,
      createdById: parsed.data.createdById,
    })
    .returning();

  return ok(result);
};

/**
 * Create a new sequence
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Sequence creation input
 * @returns Result with created sequence or error
 *
 * @example
 * ```ts
 * const result = await createSequence(db, {
 *   organizationId: 'org_123',
 *   name: 'Welcome Sequence',
 *   description: 'Initial outreach sequence',
 * });
 * ```
 */
export const createSequence = (db: DbConnection, input: CreateSequenceInput) =>
  trackedResult(
    'sequences.createSequence',
    () => createSequenceImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

/**
 * Result type for createSequence
 */
export type CreateSequenceResult = Awaited<ReturnType<typeof createSequence>>;
