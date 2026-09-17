import {
  type EmailAccount,
  emailAccount,
  withOrgScope,
} from '@borradh-workspace/database';
import { OutlookOAuthService } from '@borradh-workspace/integrations';
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
  type ConnectOutlookInput,
  connectOutlookSchema,
} from './connect-outlook.schema.js';

/**
 * Internal implementation of connect Outlook
 */
const connectOutlookImpl = async (
  db: DbConnection,
  input: ConnectOutlookInput
): Promise<Result<EmailAccount>> => {
  const parsed = connectOutlookSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, code } = parsed.data;

  try {
    const outlookOAuth = new OutlookOAuthService();
    const tokens = await outlookOAuth.exchangeCodeForTokens(code);
    const userInfo = await outlookOAuth.getUserInfo(tokens.accessToken);

    // Check if already connected
    const existing = await db.query.emailAccount.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.organizationId, organizationId), eq(t.email, userInfo.mail)),
    });

    if (existing) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Email account ${userInfo.mail} is already connected`
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
        provider: 'outlook',
        email: userInfo.mail,
        displayName: userInfo.displayName,
        encryptedCredentials: encryptedCreds,
        tokenExpiresAt,
        isActive: true,
      })
      .returning();

    return ok(result);
  } catch (error) {
    logError('integrations.connectOutlook', error, {
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
          'Failed to connect Outlook. Please try again.'
        )
      );
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while connecting Outlook'
      )
    );
  }
};

/**
 * Connect an Outlook account to an organization
 */
export const connectOutlook = (db: DbConnection, input: ConnectOutlookInput) =>
  trackedResult(
    'integrations.connectOutlook',
    () => withOrgScope((tx) => connectOutlookImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ConnectOutlookResult = Awaited<ReturnType<typeof connectOutlook>>;
