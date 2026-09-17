import { driveAccount, withOrgScope } from '@borradh-workspace/database';
import {
  GoogleDriveOAuthService,
  type GoogleStoredCredentials,
  decryptCredentials,
} from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type DisconnectDriveAccountInput,
  disconnectDriveAccountSchema,
} from './disconnect-drive-account.schema.js';

/**
 * Response type for disconnect drive account
 */
export interface DisconnectDriveAccountResponse {
  success: boolean;
}

/**
 * Internal implementation of disconnect drive account
 */
const disconnectDriveAccountImpl = async (
  db: DbConnection,
  input: DisconnectDriveAccountInput
): Promise<
  | { success: true; data: DisconnectDriveAccountResponse }
  | { success: false; error: FeatureError }
> => {
  const parsed = disconnectDriveAccountSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, accountId } = parsed.data;

  try {
    // Verify account belongs to organization and get credentials
    const existing = await db.query.driveAccount.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.id, accountId), eqOp(t.organizationId, organizationId)),
    });

    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Drive account not found')
      );
    }

    // Try to revoke the token with Google
    try {
      const credentials = decryptCredentials<GoogleStoredCredentials>(
        existing.encryptedCredentials
      );
      const driveOAuth = new GoogleDriveOAuthService();

      // Revoke refresh token if available, otherwise access token
      const tokenToRevoke = credentials.refreshToken || credentials.accessToken;
      if (tokenToRevoke) {
        await driveOAuth.revokeToken(tokenToRevoke);
      }
    } catch (revokeError) {
      // Log but continue with deletion even if revoke fails
      logError('integrations.disconnectDriveAccount.revoke', revokeError, {
        feature: 'integrations',
        extra: { organizationId, accountId },
      });
    }

    // Delete the account
    await db
      .delete(driveAccount)
      .where(
        and(
          eq(driveAccount.id, accountId),
          eq(driveAccount.organizationId, organizationId)
        )
      );

    return ok({ success: true });
  } catch (error) {
    logError('integrations.disconnectDriveAccount', error, {
      feature: 'integrations',
      extra: { organizationId, accountId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to disconnect Drive account'
      )
    );
  }
};

/**
 * Disconnect a Google Drive account from an organization
 */
export const disconnectDriveAccount = (
  db: DbConnection,
  input: DisconnectDriveAccountInput
) =>
  trackedResult(
    'integrations.disconnectDriveAccount',
    () => withOrgScope((tx) => disconnectDriveAccountImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type DisconnectDriveAccountResult = Awaited<
  ReturnType<typeof disconnectDriveAccount>
>;
