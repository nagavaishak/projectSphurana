import { emailAccount } from '@borradh-workspace/database';
import {
  GmailOAuthService,
  GmailSendService,
  OutlookOAuthService,
  OutlookSendService,
  decryptCredentials,
} from '@borradh-workspace/integrations';
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
import { type TestEmailInput, testEmailSchema } from './test-email.schema.js';

export interface TestEmailResult {
  success: boolean;
  messageId?: string;
}

interface EmailCredentials {
  accessToken: string;
  refreshToken: string;
}

// Sample data for lead placeholders
const SAMPLE_LEAD_DATA: Record<string, string> = {
  '{{lead.firstName}}': 'John',
  '{{lead.lastName}}': 'Doe',
  '{{lead.email}}': 'john.doe@example.com',
  '{{lead.phone}}': '+1 (555) 123-4567',
  '{{lead.name}}': 'John Doe',
};

/**
 * Replace lead placeholders with sample data
 */
function replacePlaceholders(text: string): string {
  let result = text;
  for (const [placeholder, value] of Object.entries(SAMPLE_LEAD_DATA)) {
    result = result.replace(
      new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'),
      value
    );
  }
  return result;
}

const testEmailImpl = async (
  db: DbConnection,
  input: TestEmailInput
): Promise<Result<TestEmailResult>> => {
  const parsed = testEmailSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { emailAccountId, to, subject, body, organizationId } = parsed.data;

  // Get the email account
  const account = await db.query.emailAccount.findFirst({
    where: and(
      eq(emailAccount.id, emailAccountId),
      eq(emailAccount.organizationId, organizationId)
    ),
  });

  if (!account) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Email account not found')
    );
  }

  if (!account.isActive) {
    return err(
      new FeatureError(ErrorCodes.INVALID_STATE, 'Email account is not active')
    );
  }

  try {
    // Decrypt credentials
    const credentials = decryptCredentials<EmailCredentials>(
      account.encryptedCredentials
    );

    // Replace placeholders in subject and body
    const processedSubject = replacePlaceholders(subject);
    const processedBody = replacePlaceholders(body);

    let messageId: string | undefined;

    if (account.provider === 'gmail') {
      // Check if token needs refresh
      let accessToken = credentials.accessToken;
      if (account.tokenExpiresAt && new Date() >= account.tokenExpiresAt) {
        const gmailOAuth = new GmailOAuthService();
        const newTokens = await gmailOAuth.refreshAccessToken(
          credentials.refreshToken
        );
        accessToken = newTokens.accessToken;

        // Update the stored token
        await db
          .update(emailAccount)
          .set({
            encryptedCredentials: (
              await import('@borradh-workspace/integrations')
            ).encryptCredentials({
              accessToken: newTokens.accessToken,
              refreshToken: credentials.refreshToken,
            }),
            tokenExpiresAt: new Date(
              Date.now() + (newTokens.expiresIn || 3600) * 1000
            ),
          })
          .where(eq(emailAccount.id, emailAccountId));
      }

      const gmailService = new GmailSendService(accessToken);
      const result = await gmailService.sendEmail({
        to,
        subject: processedSubject,
        body: processedBody,
        bodyType: 'html',
      });
      messageId = result.messageId;
    } else if (account.provider === 'outlook') {
      // Check if token needs refresh
      let accessToken = credentials.accessToken;
      if (account.tokenExpiresAt && new Date() >= account.tokenExpiresAt) {
        const outlookOAuth = new OutlookOAuthService();
        const newTokens = await outlookOAuth.refreshAccessToken(
          credentials.refreshToken
        );
        accessToken = newTokens.accessToken;

        // Update the stored token
        await db
          .update(emailAccount)
          .set({
            encryptedCredentials: (
              await import('@borradh-workspace/integrations')
            ).encryptCredentials({
              accessToken: newTokens.accessToken,
              refreshToken: credentials.refreshToken,
            }),
            tokenExpiresAt: new Date(
              Date.now() + (newTokens.expiresIn || 3600) * 1000
            ),
          })
          .where(eq(emailAccount.id, emailAccountId));
      }

      const outlookService = new OutlookSendService(accessToken);
      await outlookService.sendEmail({
        to,
        subject: processedSubject,
        body: processedBody,
        bodyType: 'html',
      });
      // Outlook API doesn't return a message ID
    } else {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_INPUT,
          `Unsupported email provider: ${account.provider}`
        )
      );
    }

    return ok({ success: true, messageId });
  } catch (error) {
    logError('sequences.testEmail', error, {
      feature: 'sequences',
      extra: { emailAccountId, to },
    });

    const message =
      error instanceof Error ? error.message : 'Failed to send test email';
    return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, message));
  }
};

export const testEmail = (db: DbConnection, input: TestEmailInput) =>
  trackedResult('sequences.testEmail', () => testEmailImpl(db, input), {
    properties: { emailAccountId: input.emailAccountId, to: input.to },
  });

export type TestEmailServiceResult = Awaited<ReturnType<typeof testEmail>>;
