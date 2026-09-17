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
  type RestoreSequenceVersionInput,
  restoreSequenceVersionSchema,
} from './restore-sequence-version.schema.js';

const restoreSequenceVersionImpl = async (
  db: DbConnection,
  input: RestoreSequenceVersionInput
): Promise<Result<typeof sequence.$inferSelect>> => {
  const parsed = restoreSequenceVersionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Verify sequence exists and belongs to organization
  const existingSequence = await db.query.sequence.findFirst({
    where: and(
      eq(sequence.id, parsed.data.sequenceId),
      eq(sequence.organizationId, parsed.data.organizationId),
      notDeleted(sequence)
    ),
  });

  if (!existingSequence) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Sequence not found', {
        sequenceId: parsed.data.sequenceId,
      })
    );
  }

  // Get the version to restore
  const versionToRestore = await db.query.sequenceVersion.findFirst({
    where: and(
      eq(sequenceVersion.id, parsed.data.versionId),
      eq(sequenceVersion.sequenceId, parsed.data.sequenceId)
    ),
  });

  if (!versionToRestore) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Version not found', {
        versionId: parsed.data.versionId,
      })
    );
  }

  // Update the sequence with the restored version's nodes and edges
  const [updatedSequence] = await db
    .update(sequence)
    .set({
      nodes: versionToRestore.nodes,
      edges: versionToRestore.edges,
    })
    .where(and(eq(sequence.id, parsed.data.sequenceId), notDeleted(sequence)))
    .returning();

  // Get the latest version number for the new version entry
  const latestVersion = await db
    .select({ version: sequenceVersion.version })
    .from(sequenceVersion)
    .where(eq(sequenceVersion.sequenceId, parsed.data.sequenceId))
    .orderBy(desc(sequenceVersion.version))
    .limit(1);

  const nextVersion =
    latestVersion.length > 0 ? latestVersion[0].version + 1 : 1;

  // Create a new version entry marking this as a restore
  await db.insert(sequenceVersion).values({
    sequenceId: parsed.data.sequenceId,
    version: nextVersion,
    nodes: versionToRestore.nodes,
    edges: versionToRestore.edges,
    changeType: 'restored',
    changeSummary: `Restored from version ${versionToRestore.version}`,
    createdById: parsed.data.userId,
  });

  return ok(updatedSequence);
};

export const restoreSequenceVersion = (
  db: DbConnection,
  input: RestoreSequenceVersionInput
) =>
  trackedResult(
    'sequences.restoreSequenceVersion',
    () => restoreSequenceVersionImpl(db, input),
    { properties: { sequenceId: input.sequenceId, versionId: input.versionId } }
  );

export type RestoreSequenceVersionResult = Awaited<
  ReturnType<typeof restoreSequenceVersion>
>;
