import { voiceScript, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type DeleteVoiceScriptInput,
  deleteVoiceScriptSchema,
} from './delete-voice-script.schema.js';

/**
 * Internal implementation of delete voice script
 */
const deleteVoiceScriptImpl = async (
  db: DbConnection,
  input: DeleteVoiceScriptInput
): Promise<Result<{ success: true }>> => {
  const parsed = deleteVoiceScriptSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }

  return withOrgScope(
    async (tx) => {
      try {
        // Check if exists
        const existing = await tx.query.voiceScript.findFirst({
          where: eq(voiceScript.id, parsed.data.id),
        });

        if (
          !existing ||
          existing.organizationId !== parsed.data.organizationId
        ) {
          return err(
            new FeatureError(ErrorCodes.NOT_FOUND, 'Voice script not found')
          );
        }

        // Don't allow deleting the default script if it's the only one
        if (existing.isDefault) {
          const count = await tx.query.voiceScript.findMany({
            where: eq(voiceScript.organizationId, existing.organizationId),
          });

          if (count.length === 1) {
            return err(
              new FeatureError(
                ErrorCodes.CONFLICT,
                'Cannot delete the only voice script. Create another script first.'
              )
            );
          }
        }

        await tx.delete(voiceScript).where(eq(voiceScript.id, parsed.data.id));

        return ok({ success: true as const });
      } catch (error) {
        logError('voice-scripts.deleteVoiceScript', error, {
          feature: 'voice-scripts',
          extra: { id: parsed.data.id },
        });
        return err(
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'Failed to delete voice script'
          )
        );
      }
    },
    { db }
  );
};

/**
 * Delete a voice script
 */
export const deleteVoiceScript = (
  db: DbConnection,
  input: DeleteVoiceScriptInput
) =>
  trackedResult(
    'voice-scripts.deleteVoiceScript',
    () => deleteVoiceScriptImpl(db, input),
    {
      properties: { id: input.id },
    }
  );

export type DeleteVoiceScriptResult = Awaited<
  ReturnType<typeof deleteVoiceScript>
>;
