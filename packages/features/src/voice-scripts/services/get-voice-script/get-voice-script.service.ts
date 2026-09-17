import { voiceScript, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetDefaultVoiceScriptInput,
  type GetVoiceScriptInput,
  getDefaultVoiceScriptSchema,
  getVoiceScriptSchema,
} from './get-voice-script.schema.js';

/**
 * Get voice script by ID
 */
const getVoiceScriptImpl = async (
  db: DbConnection,
  input: GetVoiceScriptInput
): Promise<Result<typeof voiceScript.$inferSelect>> => {
  const parsed = getVoiceScriptSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }

  return withOrgScope(
    async (tx) => {
      const result = await tx.query.voiceScript.findFirst({
        where: and(
          eq(voiceScript.id, parsed.data.id),
          eq(voiceScript.organizationId, parsed.data.organizationId)
        ),
      });

      if (!result) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Voice script not found')
        );
      }

      return ok(result);
    },
    { db }
  );
};

/**
 * Get the default voice script for an organization
 */
const getDefaultVoiceScriptImpl = async (
  db: DbConnection,
  input: GetDefaultVoiceScriptInput
): Promise<Result<typeof voiceScript.$inferSelect | null>> => {
  const parsed = getDefaultVoiceScriptSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }

  return withOrgScope(
    async (tx) => {
      const result = await tx.query.voiceScript.findFirst({
        where: and(
          eq(voiceScript.organizationId, parsed.data.organizationId),
          eq(voiceScript.isDefault, true)
        ),
      });

      // Return null if no default script exists (not an error)
      return ok(result ?? null);
    },
    { db }
  );
};

/**
 * Get a voice script by ID
 */
export const getVoiceScript = (db: DbConnection, input: GetVoiceScriptInput) =>
  trackedResult(
    'voice-scripts.getVoiceScript',
    () => getVoiceScriptImpl(db, input),
    {
      properties: { id: input.id },
      internalErrorsOnly: true,
    }
  );

/**
 * Get the default voice script for an organization
 */
export const getDefaultVoiceScript = (
  db: DbConnection,
  input: GetDefaultVoiceScriptInput
) =>
  trackedResult(
    'voice-scripts.getDefaultVoiceScript',
    () => getDefaultVoiceScriptImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetVoiceScriptResult = Awaited<ReturnType<typeof getVoiceScript>>;
export type GetDefaultVoiceScriptResult = Awaited<
  ReturnType<typeof getDefaultVoiceScript>
>;
