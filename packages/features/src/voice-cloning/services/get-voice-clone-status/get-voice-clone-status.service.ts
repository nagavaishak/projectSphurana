import {
  organization,
  voiceEmbedding,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { count, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetVoiceCloneStatusInput,
  getVoiceCloneStatusSchema,
} from './get-voice-clone-status.schema.js';

export interface VoiceCloneStatus {
  hasProfile: boolean;
  embeddingCount: number;
  lastUpdated: string | null;
}

const getVoiceCloneStatusImpl = async (
  db: DbConnection,
  input: GetVoiceCloneStatusInput
): Promise<Result<VoiceCloneStatus>> => {
  const parsed = getVoiceCloneStatusSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  return withOrgScope(
    async (tx) => {
      const org = await tx.query.organization.findFirst({
        where: eq(organization.id, organizationId),
        columns: {
          voiceStyleProfile: true,
          voiceStyleProfileUpdatedAt: true,
        },
      });

      const [embeddingCountResult] = await tx
        .select({ value: count() })
        .from(voiceEmbedding)
        .where(eq(voiceEmbedding.organizationId, organizationId));

      return ok({
        hasProfile: !!org?.voiceStyleProfile,
        embeddingCount: embeddingCountResult?.value ?? 0,
        lastUpdated: org?.voiceStyleProfileUpdatedAt?.toISOString() ?? null,
      });
    },
    { db }
  );
};

export const getVoiceCloneStatus = (
  db: DbConnection,
  input: GetVoiceCloneStatusInput
) =>
  trackedResult(
    'voiceCloning.getStatus',
    () => getVoiceCloneStatusImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );
