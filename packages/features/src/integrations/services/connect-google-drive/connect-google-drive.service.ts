import {
  type DriveAccount,
  driveAccount,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  GoogleDriveOAuthService,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ConnectGoogleDriveInput,
  connectGoogleDriveSchema,
} from './connect-google-drive.schema.js';

/**
 * Internal implementation of connect Google Drive
 */
const connectGoogleDriveImpl = async (
  db: DbConnection,
  input: ConnectGoogleDriveInput
): Promise<
  | { success: true; data: DriveAccount }
  | { success: false; error: FeatureError }
> => {
  const parsed = connectGoogleDriveSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, code } = parsed.data;

  try {
    const driveOAuth = new GoogleDriveOAuthService();
    const tokens = await driveOAuth.exchangeCodeForTokens(code);
    const userInfo = await driveOAuth.getUserInfo(tokens.accessToken);

    // Check if already connected
    const existing = await db.query.driveAccount.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.organizationId, organizationId), eq(t.email, userInfo.email)),
    });

    if (existing) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Google Drive account ${userInfo.email} is already connected`
        )
      );
    }

    // Encrypt credentials
    const encryptedCreds = encryptCredentials({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType,
      expiresIn: tokens.expiresIn,
      scope: tokens.scope,
    });

    // Calculate token expiry
    const tokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    // Store in database
    const [result] = await db
      .insert(driveAccount)
      .values({
        organizationId,
        userId,
        email: userInfo.email,
        displayName: userInfo.name,
        profilePicture: userInfo.picture,
        encryptedCredentials: encryptedCreds,
        tokenExpiresAt,
        isActive: true,
      })
      .returning();

    return ok(result);
  } catch (error) {
    logError('integrations.connectGoogleDrive', error, {
      feature: 'integrations',
      extra: { organizationId, userId },
    });

    if (
      error instanceof Error &&
      error.message.includes('Failed to exchange')
    ) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'Failed to connect Google Drive. Please try again.'
        )
      );
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while connecting Google Drive'
      )
    );
  }
};

/**
 * Connect a Google Drive account to an organization
 */
export const connectGoogleDrive = (
  db: DbConnection,
  input: ConnectGoogleDriveInput
) =>
  trackedResult(
    'integrations.connectGoogleDrive',
    () => withOrgScope((tx) => connectGoogleDriveImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ConnectGoogleDriveResult = Awaited<
  ReturnType<typeof connectGoogleDrive>
>;
