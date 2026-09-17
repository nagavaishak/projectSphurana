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
  type CreateSequenceVersionInput,
  createSequenceVersionSchema,
} from './create-sequence-version.schema.js';

const createSequenceVersionImpl = async (
  db: DbConnection,
  input: CreateSequenceVersionInput
): Promise<Result<typeof sequenceVersion.$inferSelect>> => {
  const parsed = createSequenceVersionSchema.safeParse(input);
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

  // Get the latest version number
  const latestVersion = await db
    .select({ version: sequenceVersion.version })
    .from(sequenceVersion)
    .where(eq(sequenceVersion.sequenceId, parsed.data.sequenceId))
    .orderBy(desc(sequenceVersion.version))
    .limit(1);

  const nextVersion =
    latestVersion.length > 0 ? latestVersion[0].version + 1 : 1;

  // Create the new version
  const [newVersion] = await db
    .insert(sequenceVersion)
    .values({
      sequenceId: parsed.data.sequenceId,
      version: nextVersion,
      nodes: parsed.data.nodes,
      edges: parsed.data.edges,
      changeType: parsed.data.changeType,
      changeSummary: parsed.data.changeSummary,
      createdById: parsed.data.userId,
    })
    .returning();

  return ok(newVersion);
};

export const createSequenceVersion = (
  db: DbConnection,
  input: CreateSequenceVersionInput
) =>
  trackedResult(
    'sequences.createSequenceVersion',
    () => createSequenceVersionImpl(db, input),
    {
      properties: {
        sequenceId: input.sequenceId,
        changeType: input.changeType,
      },
    }
  );

export type CreateSequenceVersionResult = Awaited<
  ReturnType<typeof createSequenceVersion>
>;
