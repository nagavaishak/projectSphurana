import { sequence, sequenceVersion } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';
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
  type UpdateSequenceInput,
  updateSequenceSchema,
} from './update-sequence.schema.js';

const updateSequenceImpl = async (
  db: DbConnection,
  input: UpdateSequenceInput
): Promise<Result<typeof result>> => {
  const parsed = updateSequenceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const existing = await db.query.sequence.findFirst({
    where: (sequence, { eq, and, isNull }) =>
      and(
        eq(sequence.id, parsed.data.id),
        eq(sequence.organizationId, parsed.data.organizationId),
        isNull(sequence.deletedAt)
      ),
  });

  if (!existing) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Sequence with ID ${parsed.data.id} not found`,
        { id: parsed.data.id }
      )
    );
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined)
    updateData.description = parsed.data.description;
  if (parsed.data.triggerOnNewLead !== undefined)
    updateData.triggerOnNewLead = parsed.data.triggerOnNewLead;
  if (parsed.data.scheduleNextDay !== undefined)
    updateData.scheduleNextDay = parsed.data.scheduleNextDay;
  if (parsed.data.nodes !== undefined) updateData.nodes = parsed.data.nodes;
  if (parsed.data.edges !== undefined) updateData.edges = parsed.data.edges;
  if (parsed.data.settings !== undefined)
    updateData.settings = parsed.data.settings;
  if (parsed.data.setupCompleted !== undefined)
    updateData.setupCompleted = parsed.data.setupCompleted;

  const [result] = await db
    .update(sequence)
    .set(updateData)
    .where(
      and(
        eq(sequence.id, parsed.data.id),
        eq(sequence.organizationId, parsed.data.organizationId),
        notDeleted(sequence)
      )
    )
    .returning();

  // Create a version entry when nodes or edges are updated
  if (parsed.data.nodes !== undefined || parsed.data.edges !== undefined) {
    // Get the latest version number
    const latestVersion = await db
      .select({ version: sequenceVersion.version })
      .from(sequenceVersion)
      .where(eq(sequenceVersion.sequenceId, parsed.data.id))
      .orderBy(desc(sequenceVersion.version))
      .limit(1);

    const nextVersion =
      latestVersion.length > 0 ? latestVersion[0].version + 1 : 1;

    // Create the new version
    await db.insert(sequenceVersion).values({
      sequenceId: parsed.data.id,
      version: nextVersion,
      nodes: result.nodes ?? [],
      edges: result.edges ?? [],
      changeType: 'updated',
      changeSummary: null,
      createdById: parsed.data.userId,
    });
  }

  return ok(result);
};

export const updateSequence = (db: DbConnection, input: UpdateSequenceInput) =>
  trackedResult(
    'sequences.updateSequence',
    () => updateSequenceImpl(db, input),
    {
      properties: { sequenceId: input.id },
    }
  );

export type UpdateSequenceResult = Awaited<ReturnType<typeof updateSequence>>;
