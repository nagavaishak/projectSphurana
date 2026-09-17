import {
  type ClaireActionIntentType,
  claireActionIntent,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../../shared/index.js';
import { normalizeActionKey } from '../normalize.js';
import {
  type RecordActionIntentInput,
  recordActionIntentSchema,
} from './record-action-intent.schema.js';

const recordActionIntentImpl = async (
  db: DbConnection,
  input: RecordActionIntentInput
): Promise<Result<{ id: string }>> => {
  const parsed = recordActionIntentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    conversationId,
    action,
    key,
    resourceId,
    displayName,
    metadata,
  } = parsed.data;

  try {
    const [row] = await withOrgScope(
      (tx) =>
        tx
          .insert(claireActionIntent)
          .values({
            organizationId,
            conversationId: conversationId ?? null,
            action: action as ClaireActionIntentType,
            normalizedKey: normalizeActionKey(key),
            resourceId: resourceId ?? null,
            displayName: displayName ?? null,
            metadata: metadata ?? null,
          })
          .returning({ id: claireActionIntent.id }),
      { db }
    );

    if (!row) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to record action intent'
        )
      );
    }

    return ok(row);
  } catch (error) {
    logError('assistant.recordActionIntent', error, {
      feature: 'assistant',
      extra: { organizationId, action, resourceId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to record action intent'
      )
    );
  }
};

/**
 * Record a normalised Claire action intent (Phase 4 dedupe). Best-effort at
 * the call site: a failure here must never break the create/launch it follows.
 */
export const recordActionIntent = (
  db: DbConnection,
  input: RecordActionIntentInput
) =>
  trackedResult(
    'assistant.recordActionIntent',
    () => recordActionIntentImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        action: input.action,
      },
    }
  );

export type RecordActionIntentResult = Awaited<
  ReturnType<typeof recordActionIntent>
>;
