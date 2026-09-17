import {
  type EmailAccount,
  emailAccount,
  withOrgScope,
} from '@borradh-workspace/database';
import { GmailOAuthService } from '@borradh-workspace/integrations';
import { encryptCredentials } from '@borradh-workspace/integrations';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ConnectGmailInput,
  connectGmailSchema,
} from './connect-gmail.schema.js';

/**
 * Internal implementation of connect Gmail
 */
const connectGmailImpl = async (
  db: DbConnection,
  input: ConnectGmailInput
): Promise<Result<EmailAccount>> => {
  const parsed = connectGmailSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, code } = parsed.data;

  try {
    const gmailOAuth = new GmailOAuthService();
    const tokens = await gmailOAuth.exchangeCodeForTokens(code);
    const userInfo = await gmailOAuth.getUserInfo(tokens.accessToken);

    // Check if already connected
    const existing = await db.query.emailAccount.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.organizationId, organizationId), eq(t.email, userInfo.email)),
    });

    if (existing) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Email account ${userInfo.email} is already connected`
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
      .insert(emailAccount)
      .values({
        organizationId,
        provider: 'gmail',
        email: userInfo.email,
        displayName: userInfo.name,
        encryptedCredentials: encryptedCreds,
        tokenExpiresAt,
        isActive: true,
      })
      .returning();

    return ok(result);
  } catch (error) {
    logError('integrations.connectGmail', error, {
      feature: 'integrations',
      extra: { organizationId },
    });

    if (
      error instanceof Error &&
      error.message.includes('Failed to exchange')
    ) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'Failed to connect Gmail. Please try again.'
        )
      );
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while connecting Gmail'
      )
    );
  }
};

/**
 * Connect a Gmail account to an organization
 */
export const connectGmail = (db: DbConnection, input: ConnectGmailInput) =>
  trackedResult(
    'integrations.connectGmail',
    () => withOrgScope((tx) => connectGmailImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ConnectGmailResult = Awaited<ReturnType<typeof connectGmail>>;
