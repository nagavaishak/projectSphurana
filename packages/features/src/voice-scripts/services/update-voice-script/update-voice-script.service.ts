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
  type UpdateVoiceScriptInput,
  updateVoiceScriptSchema,
} from './update-voice-script.schema.js';

/**
 * Internal implementation of update voice script
 */
const updateVoiceScriptImpl = async (
  db: DbConnection,
  input: UpdateVoiceScriptInput
): Promise<Result<typeof voiceScript.$inferSelect>> => {
  const parsed = updateVoiceScriptSchema.safeParse(input);
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
        // Check if script exists
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

        // If setting as default, unset other defaults for this org
        if (parsed.data.isDefault === true) {
          await tx
            .update(voiceScript)
            .set({ isDefault: false })
            .where(
              and(
                eq(voiceScript.organizationId, existing.organizationId),
                eq(voiceScript.isDefault, true)
              )
            );
        }

        // Build update object (only include defined fields)
        const updateData: Partial<typeof voiceScript.$inferInsert> = {};
        if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
        if (parsed.data.isDefault !== undefined)
          updateData.isDefault = parsed.data.isDefault;
        if (parsed.data.initialMessage !== undefined)
          updateData.initialMessage = parsed.data.initialMessage;
        if (parsed.data.script !== undefined)
          updateData.script = parsed.data.script;
        if (parsed.data.qualificationQuestions !== undefined)
          updateData.qualificationQuestions =
            parsed.data.qualificationQuestions;
        if (parsed.data.followUps !== undefined)
          updateData.followUps = parsed.data.followUps;
        if (parsed.data.agentConfig !== undefined)
          updateData.agentConfig = parsed.data.agentConfig;

        const [result] = await tx
          .update(voiceScript)
          .set(updateData)
          .where(eq(voiceScript.id, parsed.data.id))
          .returning();

        return ok(result);
      } catch (error) {
        logError('voice-scripts.updateVoiceScript', error, {
          feature: 'voice-scripts',
          extra: { id: parsed.data.id },
        });
        return err(
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'Failed to update voice script'
          )
        );
      }
    },
    { db }
  );
};

/**
 * Update an existing voice script
 */
export const updateVoiceScript = (
  db: DbConnection,
  input: UpdateVoiceScriptInput
) =>
  trackedResult(
    'voice-scripts.updateVoiceScript',
    () => updateVoiceScriptImpl(db, input),
    {
      properties: { id: input.id },
    }
  );

export type UpdateVoiceScriptResult = Awaited<
  ReturnType<typeof updateVoiceScript>
>;
