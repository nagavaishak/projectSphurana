import { voiceScript, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListVoiceScriptsInput,
  listVoiceScriptsSchema,
} from './list-voice-scripts.schema.js';

/**
 * Internal implementation of list voice scripts
 */
const listVoiceScriptsImpl = async (
  db: DbConnection,
  input: ListVoiceScriptsInput
) => {
  const parsed = listVoiceScriptsSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }

  const { organizationId, limit, offset } = parsed.data;

  return withOrgScope(
    async (tx) => {
      const items = await tx.query.voiceScript.findMany({
        where: eq(voiceScript.organizationId, organizationId),
        limit,
        offset,
        orderBy: [desc(voiceScript.isDefault), desc(voiceScript.createdAt)],
      });

      return ok({ items, limit, offset });
    },
    { db }
  );
};

/**
 * List voice scripts for an organization
 */
export const listVoiceScripts = (
  db: DbConnection,
  input: ListVoiceScriptsInput
) =>
  trackedResult(
    'voice-scripts.listVoiceScripts',
    () => listVoiceScriptsImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ListVoiceScriptsResult = Awaited<
  ReturnType<typeof listVoiceScripts>
>;
