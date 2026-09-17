import {
  assistantMessage,
  claireConfirmationToken,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type VerifyConfirmationTokenInput,
  verifyConfirmationTokenSchema,
} from './verify-confirmation-token.schema.js';

export type ConfirmationVerification =
  | {
      valid: true;
      payload: Record<string, unknown> | null;
    }
  | {
      valid: false;
      reason:
        | 'expired'
        | 'consumed'
        | 'mismatch'
        | 'not_found'
        | 'no_user_turn';
    };

const verifyConfirmationTokenImpl = async (
  db: DbConnection,
  input: VerifyConfirmationTokenInput
): Promise<Result<ConfirmationVerification>> => {
  const parsed = verifyConfirmationTokenSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, conversationId, action, resourceId, token } =
    parsed.data;

  try {
    const result = await withOrgScope(
      async (tx): Promise<Result<ConfirmationVerification>> => {
        // Look up the token row by primary key. We then validate that all
        // scope fields (org, conversation, action, resource) match before
        // marking it consumed. This catches a model passing a real token from
        // a different tool call.
        const row = await tx.query.claireConfirmationToken.findFirst({
          where: eq(claireConfirmationToken.id, token),
        });

        if (!row) {
          return ok({ valid: false, reason: 'not_found' as const });
        }

        if (row.consumedAt) {
          return ok({ valid: false, reason: 'consumed' as const });
        }

        if (row.expiresAt.getTime() <= Date.now()) {
          return ok({ valid: false, reason: 'expired' as const });
        }

        if (
          row.organizationId !== organizationId ||
          row.conversationId !== conversationId ||
          row.action !== action ||
          // resourceId is optional — when the caller can't echo one back (e.g.
          // create-tool inputs that don't carry an id), skip the check. The
          // payload-mismatch check in the factory still binds the operator's
          // approval to the executed input.
          (resourceId !== undefined && row.resourceId !== resourceId)
        ) {
          return ok({ valid: false, reason: 'mismatch' as const });
        }

        // Turn-boundary rule (Phase 6, finding #131): a token may only be
        // consumed after an INTERVENING USER MESSAGE — the operator must have
        // said something after the proposal card was shown. Messages persist
        // at end-of-turn, so a same-turn execute finds no user message newer
        // than the token and is refused; once the proposal turn completes and
        // the operator replies, the next turn's execute finds the persisted
        // user message and passes. `createdInMessageId` (the latest persisted
        // user message at creation time) is excluded so a token can never be
        // approved by the turn that created it.
        const approvingMessage = await tx.query.assistantMessage.findFirst({
          where: and(
            eq(assistantMessage.conversationId, row.conversationId),
            eq(assistantMessage.role, 'user'),
            gt(assistantMessage.createdAt, row.createdAt),
            ...(row.createdInMessageId
              ? [ne(assistantMessage.id, row.createdInMessageId)]
              : [])
          ),
          orderBy: [desc(assistantMessage.createdAt)],
          columns: { id: true },
        });

        if (!approvingMessage) {
          return ok({ valid: false, reason: 'no_user_turn' as const });
        }

        // Atomically mark consumed. If another concurrent call already consumed
        // it, the row update will affect zero rows — treat that as `consumed`.
        const [updated] = await tx
          .update(claireConfirmationToken)
          .set({
            consumedAt: new Date(),
            // The approval record: the newest persisted user turn after the
            // proposal. Chat approval is the approval (no button) — this id
            // is the on-record proof of the intervening user turn.
            approvedInMessageId: approvingMessage.id,
          })
          .where(
            and(
              eq(claireConfirmationToken.id, token),
              isNull(claireConfirmationToken.consumedAt)
            )
          )
          .returning({ id: claireConfirmationToken.id });

        if (!updated) {
          return ok({ valid: false, reason: 'consumed' as const });
        }

        return ok({
          valid: true,
          payload: row.payload ?? null,
        });
      },
      { db }
    );

    return result;
  } catch (error) {
    logError('assistant.verifyConfirmationToken', error, {
      feature: 'assistant',
      extra: { organizationId, conversationId, action, resourceId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to verify confirmation token'
      )
    );
  }
};

export const verifyConfirmationToken = (
  db: DbConnection,
  input: VerifyConfirmationTokenInput
) =>
  trackedResult(
    'assistant.verifyConfirmationToken',
    () => verifyConfirmationTokenImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        action: input.action,
      },
      // Token mismatches and expiries are expected outcomes, not internal
      // errors. Don't log them — only catch-and-throw.
      internalErrorsOnly: true,
    }
  );

export type VerifyConfirmationTokenResult = Awaited<
  ReturnType<typeof verifyConfirmationToken>
>;
