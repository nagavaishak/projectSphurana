import { sequence, sequenceVersion, user } from '@borradh-workspace/database';
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
  type ListSequenceVersionsInput,
  listSequenceVersionsSchema,
} from './list-sequence-versions.schema.js';

export interface SequenceVersionWithUser {
  id: string;
  sequenceId: string;
  version: number;
  nodes: unknown;
  edges: unknown;
  changeType: 'created' | 'updated' | 'published' | 'restored';
  changeSummary: string | null;
  createdAt: Date;
  createdBy: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
}

const listSequenceVersionsImpl = async (
  db: DbConnection,
  input: ListSequenceVersionsInput
): Promise<Result<{ versions: SequenceVersionWithUser[]; total: number }>> => {
  const parsed = listSequenceVersionsSchema.safeParse(input);
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

  // Get versions with user info
  const versions = await db
    .select({
      id: sequenceVersion.id,
      sequenceId: sequenceVersion.sequenceId,
      version: sequenceVersion.version,
      nodes: sequenceVersion.nodes,
      edges: sequenceVersion.edges,
      changeType: sequenceVersion.changeType,
      changeSummary: sequenceVersion.changeSummary,
      createdAt: sequenceVersion.createdAt,
      createdById: sequenceVersion.createdById,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
    })
    .from(sequenceVersion)
    .innerJoin(user, eq(sequenceVersion.createdById, user.id))
    .where(eq(sequenceVersion.sequenceId, parsed.data.sequenceId))
    .orderBy(desc(sequenceVersion.version))
    .limit(parsed.data.limit)
    .offset(parsed.data.offset);

  // Get total count
  const allVersions = await db
    .select({ id: sequenceVersion.id })
    .from(sequenceVersion)
    .where(eq(sequenceVersion.sequenceId, parsed.data.sequenceId));

  // innerJoin guarantees createdById is not null for returned rows
  const formattedVersions: SequenceVersionWithUser[] = versions.map((v) => ({
    id: v.id,
    sequenceId: v.sequenceId,
    version: v.version,
    nodes: v.nodes,
    edges: v.edges,
    changeType: v.changeType,
    changeSummary: v.changeSummary,
    createdAt: v.createdAt,
    createdBy: {
      id: v.createdById ?? '',
      name: v.userName,
      email: v.userEmail,
      image: v.userImage,
    },
  }));

  return ok({
    versions: formattedVersions,
    total: allVersions.length,
  });
};

export const listSequenceVersions = (
  db: DbConnection,
  input: ListSequenceVersionsInput
) =>
  trackedResult(
    'sequences.listSequenceVersions',
    () => listSequenceVersionsImpl(db, input),
    { properties: { sequenceId: input.sequenceId } }
  );

export type ListSequenceVersionsResult = Awaited<
  ReturnType<typeof listSequenceVersions>
>;
