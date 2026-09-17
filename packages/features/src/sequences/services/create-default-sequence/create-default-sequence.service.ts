import { sequence } from '@borradh-workspace/database';
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
import { createDefaultFollowUpSequenceTemplate } from '../../templates/index.js';
import {
  type CreateDefaultSequenceInput,
  createDefaultSequenceSchema,
} from './create-default-sequence.schema.js';

const DEFAULT_SEQUENCE_NAME = 'Default Follow-Up Sequence';

/**
 * Internal implementation of create default sequence
 */
const createDefaultSequenceImpl = async (
  db: DbConnection,
  input: CreateDefaultSequenceInput
): Promise<Result<typeof sequence.$inferSelect>> => {
  // Validate input
  const parsed = createDefaultSequenceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, createdById } = parsed.data;

  // Check if default sequence already exists for this org
  const existing = await db.query.sequence.findFirst({
    where: and(
      eq(sequence.organizationId, organizationId),
      eq(sequence.name, DEFAULT_SEQUENCE_NAME),
      notDeleted(sequence)
    ),
  });

  if (existing) {
    // Return existing sequence (don't create duplicate)
    return ok(existing);
  }

  // Generate the template
  const template = createDefaultFollowUpSequenceTemplate();

  // Create the sequence (inactive by default - needs integrations first)
  const [result] = await db
    .insert(sequence)
    .values({
      organizationId,
      name: template.name,
      description: template.description,
      isActive: false, // Cannot be activated until integrations are configured
      triggerOnNewLead: true, // Auto-trigger on new Facebook leads
      scheduleNextDay: false, // Use business hours instead
      nodes: template.nodes,
      edges: template.edges,
      createdById,
    })
    .returning();

  return ok(result);
};

/**
 * Create the default follow-up sequence for an organization
 *
 * This creates a pre-configured sequence template that triggers on Facebook leads
 * and follows up with AI calls and email over 3 days.
 *
 * The sequence is created as INACTIVE - it needs integrations configured before activation.
 *
 * If a default sequence already exists for the organization, returns the existing one.
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Organization and user IDs
 * @returns Result with created or existing sequence
 *
 * @example
 * ```ts
 * const result = await createDefaultSequence(db, {
 *   organizationId: 'org_123',
 *   createdById: 'user_123',
 * });
 *
 * if (result.success) {
 *   console.log('Default sequence ready:', result.data.id);
 * }
 * ```
 */
export const createDefaultSequence = (
  db: DbConnection,
  input: CreateDefaultSequenceInput
) =>
  trackedResult(
    'sequences.createDefaultSequence',
    () => createDefaultSequenceImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

/**
 * Result type for createDefaultSequence
 */
export type CreateDefaultSequenceResult = Awaited<
  ReturnType<typeof createDefaultSequence>
>;

/**
 * Name of the default sequence for checking existence
 */
export { DEFAULT_SEQUENCE_NAME };
