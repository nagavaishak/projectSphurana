import { randomUUID } from 'node:crypto';
import { voiceScript, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
  type CreateVoiceScriptInput,
  createVoiceScriptSchema,
} from './create-voice-script.schema.js';

/**
 * Internal implementation of create voice script
 */
const createVoiceScriptImpl = async (
  db: DbConnection,
  input: CreateVoiceScriptInput
): Promise<Result<typeof voiceScript.$inferSelect>> => {
  // Validate input
  const parsed = createVoiceScriptSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  return withOrgScope(
    async (tx) => {
      try {
        // If this is a default script, unset other defaults for this org
        if (parsed.data.isDefault) {
          await tx
            .update(voiceScript)
            .set({ isDefault: false })
            .where(
              and(
                eq(voiceScript.organizationId, parsed.data.organizationId),
                eq(voiceScript.isDefault, true)
              )
            );
        }

        // Create the voice script
        const [result] = await tx
          .insert(voiceScript)
          .values({
            id: randomUUID(),
            organizationId: parsed.data.organizationId,
            name: parsed.data.name,
            isDefault: parsed.data.isDefault,
            initialMessage: parsed.data.initialMessage,
            script: parsed.data.script,
            qualificationQuestions: parsed.data.qualificationQuestions,
            followUps: parsed.data.followUps,
            agentConfig: parsed.data.agentConfig,
          })
          .returning();

        return ok(result);
      } catch (error) {
        logError('voice-scripts.createVoiceScript', error, {
          feature: 'voice-scripts',
          extra: { organizationId: parsed.data.organizationId },
        });
        return err(
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'Failed to create voice script'
          )
        );
      }
    },
    { db }
  );
};

/**
 * Create a new voice script for AI voice caller
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Voice script creation input
 * @returns Result with created voice script or error
 */
export const createVoiceScript = (
  db: DbConnection,
  input: CreateVoiceScriptInput
) =>
  trackedResult(
    'voice-scripts.createVoiceScript',
    () => createVoiceScriptImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type CreateVoiceScriptResult = Awaited<
  ReturnType<typeof createVoiceScript>
>;
