import {
  type ClaireConfirmationAction,
  assistantMessage,
  claireConfirmationToken,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateConfirmationTokenInput,
  createConfirmationTokenSchema,
} from './create-confirmation-token.schema.js';

const DEFAULT_TTL_MINUTES = 30;

export interface CreatedConfirmationToken {
  id: string;
  expiresAt: Date;
}

const createConfirmationTokenImpl = async (
  db: DbConnection,
  input: CreateConfirmationTokenInput
): Promise<Result<CreatedConfirmationToken>> => {
  const parsed = createConfirmationTokenSchema.safeParse(input);
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
    resourceId,
    payload,
    ttlMinutes,
  } = parsed.data;

  const ttl = ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttl * 60_000);

  try {
    const [row] = await withOrgScope(
      async (tx) => {
        // Turn-boundary anchor (Phase 6, finding #131): record the latest
        // PERSISTED user message at creation time. Messages persist at
        // end-of-turn, so this is the user turn BEFORE the one proposing the
        // action (null on a conversation's first turn). Verification refuses
        // consumption until a NEWER user message exists — the operator's
        // chat approval after the card is shown.
        const latestUserMessage = await tx.query.assistantMessage.findFirst({
          where: and(
            eq(assistantMessage.conversationId, conversationId),
            eq(assistantMessage.role, 'user')
          ),
          orderBy: [desc(assistantMessage.createdAt)],
          columns: { id: true },
        });

        return tx
          .insert(claireConfirmationToken)
          .values({
            organizationId,
            conversationId,
            action: action as ClaireConfirmationAction,
            resourceId,
            payload: payload ?? null,
            expiresAt,
            createdInMessageId: latestUserMessage?.id ?? null,
          })
          .returning({
            id: claireConfirmationToken.id,
            expiresAt: claireConfirmationToken.expiresAt,
          });
      },
      { db }
    );

    if (!row) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to create confirmation token'
        )
      );
    }

    return ok(row);
  } catch (error) {
    logError('assistant.createConfirmationToken', error, {
      feature: 'assistant',
      extra: { organizationId, conversationId, action, resourceId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create confirmation token'
      )
    );
  }
};

export const createConfirmationToken = (
  db: DbConnection,
  input: CreateConfirmationTokenInput
) =>
  trackedResult(
    'assistant.createConfirmationToken',
    () => createConfirmationTokenImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        action: input.action,
      },
    }
  );

export type CreateConfirmationTokenResult = Awaited<
  ReturnType<typeof createConfirmationToken>
>;
