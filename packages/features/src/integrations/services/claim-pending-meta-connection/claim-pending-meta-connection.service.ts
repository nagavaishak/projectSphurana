import { metaPendingConnection } from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
} from '../../../shared/index.js';
import { queueVoiceIngest } from '../../../voice-cloning/index.js';
import {
  type PersistMetaConnectionResult,
  persistMetaConnection,
} from '../_shared/index.js';
import {
  type ClaimPendingMetaConnectionInput,
  claimPendingMetaConnectionSchema,
} from './claim-pending-meta-connection.schema.js';

/**
 * Attach a self-serve Facebook Login for Business connection to a workspace.
 *
 * This is the second half of the shareable link: the prospect authorised
 * before anyone knew which workspace they were, and an operator now says which
 * one. The Page name they authorised is the identity, so this is a recognition
 * task rather than a matching one.
 *
 * The row is marked claimed rather than deleted, so an attach can be audited
 * afterwards — "which admin pointed this Page at that workspace" is exactly
 * the question asked when a business's content appears somewhere it should
 * not.
 *
 * Claiming is guarded on `isClaimed` INSIDE the update, not by a read-then-
 * write: two admins on the same list would otherwise both pass a check and
 * both attach the same connection to different workspaces.
 */
const claimPendingMetaConnectionImpl = async (
  db: DbConnection,
  input: ClaimPendingMetaConnectionInput
): Promise<Result<PersistMetaConnectionResult>> => {
  const parsed = claimPendingMetaConnectionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    pendingConnectionId,
    organizationId,
    claimedById,
    pageIds,
    adAccountId,
    adAccountName,
  } = parsed.data;

  let pending: typeof metaPendingConnection.$inferSelect | undefined;
  try {
    // The claim itself IS the lock: only the caller whose UPDATE flips
    // is_claimed from false gets a row back.
    [pending] = await db
      .update(metaPendingConnection)
      .set({
        isClaimed: true,
        claimedByOrganizationId: organizationId,
        claimedAt: new Date(),
      })
      .where(
        and(
          eq(metaPendingConnection.id, pendingConnectionId),
          eq(metaPendingConnection.isClaimed, false)
        )
      )
      .returning();
  } catch (error) {
    logError('integrations.claimPendingMetaConnection.lock', error, {
      feature: 'integrations',
      extra: { pendingConnectionId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to claim that connection'
      )
    );
  }

  if (!pending) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'That connection has already been attached to a workspace, or no longer exists.'
      )
    );
  }

  let credentials: { accessToken?: string } | null = null;
  try {
    credentials = decryptCredentials<{ accessToken?: string }>(
      pending.encryptedCredentials
    );
  } catch (error) {
    logError('integrations.claimPendingMetaConnection.decrypt', error, {
      feature: 'integrations',
      extra: { pendingConnectionId, organizationId },
    });
  }
  if (!credentials?.accessToken) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'The stored credential for that connection could not be read.'
      )
    );
  }

  return persistMetaConnection({
    db,
    organizationId,
    connectedById: claimedById,
    accessToken: credentials.accessToken,
    connectionMethod: 'flfb',
    // Normally null. A real expiry here means the FLfB configuration issued a
    // user token rather than a system-user one, and it is carried through so
    // the refresh job renews it instead of the row silently dying.
    tokenExpiresAt: pending.tokenExpiresAt,
    pageIds,
    adAccountId,
    adAccountName,
    // WhatsApp does not ride on an FLfB token; those numbers arrive through
    // Embedded Signup onto our portfolio and keep their own credentials.
    wabaIds: [],
    operation: 'integrations.claimPendingMetaConnection',
  });
};

/** Attach a parked self-serve Meta connection to an organization. */
export const claimPendingMetaConnection = (
  db: DbConnection,
  input: ClaimPendingMetaConnectionInput
) =>
  trackedResult(
    'integrations.claimPendingMetaConnection',
    async () => {
      const result = await claimPendingMetaConnectionImpl(db, input);

      // Voice ingest reads the page rows, so it can only be queued once they
      // are committed — and must never be able to fail the claim.
      if (result.success && result.data.pageRowIds.length > 0) {
        await Promise.allSettled(
          result.data.pageRowIds.map((metaAdsPageId) =>
            queueVoiceIngest({
              organizationId: input.organizationId,
              metaAdsPageId,
              triggerReason: 'page_connect',
            })
          )
        );
      }

      return result;
    },
    { properties: { organizationId: input.organizationId } }
  );

export type ClaimPendingMetaConnectionResult = Awaited<
  ReturnType<typeof claimPendingMetaConnection>
>;
