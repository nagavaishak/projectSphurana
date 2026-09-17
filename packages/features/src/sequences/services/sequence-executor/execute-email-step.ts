import { emailAccount } from '@borradh-workspace/database';
import { sendHtmlEmail } from '@borradh-workspace/email';
import {
  GmailOAuthService,
  GmailSendService,
  OutlookOAuthService,
  OutlookSendService,
  decryptCredentials,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import { createLogger } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { BillingErrorCodes } from '../../../billing/models/billing-error.types.js';
import type { CreditChannel } from '../../../billing/models/billing.types.js';
import { useCredits } from '../../../billing/services/use-credits/use-credits.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { PLATFORM_EMAIL_ID } from '../../models/platform-constants.js';
import { interpolateMessage } from './interpolate-message.js';
import type {
  EmailCredentials,
  EmailNodeConfig,
  ExecutionResultData,
  LeadData,
  SequenceStep,
} from './types.js';

const logger = createLogger('SequenceExecutor');

/**
 * Execute an email step (platform, Gmail, or Outlook)
 */
export async function executeEmailStep(
  db: DbConnection,
  leadData: LeadData,
  step: SequenceStep,
  organizationId: string
): Promise<Result<ExecutionResultData>> {
  const emailConfig = step.config as unknown as EmailNodeConfig;

  // Validate email account is configured
  if (!emailConfig.emailAccountId) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_INPUT,
        'Email step is missing email account configuration'
      )
    );
  }

  // Validate lead has email
  if (!leadData.email) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_INPUT,
        'Lead does not have an email address'
      )
    );
  }

  // Validate subject and body exist
  if (!emailConfig.subject || !emailConfig.body) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_INPUT,
        'Email step is missing subject or body'
      )
    );
  }

  // --- Platform email branch ---
  if (emailConfig.emailAccountId === PLATFORM_EMAIL_ID) {
    return executePlatformEmail(
      db,
      leadData,
      step,
      emailConfig,
      organizationId
    );
  }

  // --- Connected account email (Gmail / Outlook) ---
  return executeConnectedEmail(db, leadData, step, emailConfig, organizationId);
}

/**
 * Send email via platform (SES/sendHtmlEmail)
 */
async function executePlatformEmail(
  db: DbConnection,
  leadData: LeadData,
  step: SequenceStep,
  emailConfig: EmailNodeConfig,
  organizationId: string
): Promise<Result<ExecutionResultData>> {
  // Deduct credits
  const platformCreditResult = await useCredits(db, {
    organizationId,
    channel: 'email' as CreditChannel,
    quantity: 1,
    referenceId: step.id,
    referenceType: 'sequence_step',
    description: `Platform email to lead ${leadData.id}`,
  });

  if (!platformCreditResult.success) {
    logger.warn('Insufficient credits for platform email', {
      leadId: leadData.id,
      organizationId,
      error: platformCreditResult.error.code,
    });
    return err(
      new FeatureError(
        platformCreditResult.error.code ===
          BillingErrorCodes.INSUFFICIENT_CREDITS
          ? ErrorCodes.FORBIDDEN
          : ErrorCodes.INTERNAL_ERROR,
        platformCreditResult.error.message
      )
    );
  }

  const processedSubject = interpolateMessage(emailConfig.subject, leadData);
  const processedBody = interpolateMessage(emailConfig.body, leadData);

  // fromName is stored in config by applyWizardConfig
  const fromName = (step.config as Record<string, unknown>).fromName as
    | string
    | undefined;

  const platformResult = await sendHtmlEmail({
    to: leadData.email ?? '',
    subject: processedSubject,
    html: processedBody,
    fromName: fromName || undefined,
    replyTo: emailConfig.replyTo,
  });

  logger.info('Platform email sent', {
    leadId: leadData.id,
    messageId: platformResult.messageId,
  });

  return ok({
    type: 'email',
    sent: true,
    messageId: platformResult.messageId,
  });
}

/**
 * Send email via connected Gmail or Outlook account
 */
async function executeConnectedEmail(
  db: DbConnection,
  leadData: LeadData,
  step: SequenceStep,
  emailConfig: EmailNodeConfig,
  organizationId: string
): Promise<Result<ExecutionResultData>> {
  // Get the email account
  const account = await db.query.emailAccount.findFirst({
    where: and(
      eq(emailAccount.id, emailConfig.emailAccountId),
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

  // Deduct credits before sending
  const emailCreditResult = await useCredits(db, {
    organizationId,
    channel: 'email' as CreditChannel,
    quantity: 1,
    referenceId: step.id,
    referenceType: 'sequence_step',
    description: `Email to lead ${leadData.id}`,
  });

  if (!emailCreditResult.success) {
    logger.warn('Insufficient credits for email', {
      leadId: leadData.id,
      organizationId,
      error: emailCreditResult.error.code,
    });
    return err(
      new FeatureError(
        emailCreditResult.error.code === BillingErrorCodes.INSUFFICIENT_CREDITS
          ? ErrorCodes.FORBIDDEN
          : ErrorCodes.INTERNAL_ERROR,
        emailCreditResult.error.message
      )
    );
  }

  // Decrypt credentials
  const credentials = decryptCredentials<EmailCredentials>(
    account.encryptedCredentials
  );

  // Interpolate template variables in subject and body
  const processedSubject = interpolateMessage(emailConfig.subject, leadData);
  const processedBody = interpolateMessage(emailConfig.body, leadData);

  let messageId: string | undefined;

  if (account.provider === 'gmail') {
    messageId = await sendViaGmail(
      db,
      credentials,
      account,
      emailConfig,
      leadData.email ?? '',
      processedSubject,
      processedBody
    );
  } else if (account.provider === 'outlook') {
    await sendViaOutlook(
      db,
      credentials,
      account,
      emailConfig,
      leadData.email ?? '',
      processedSubject,
      processedBody
    );
    // Outlook API doesn't return a message ID
  } else {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_INPUT,
        `Unsupported email provider: ${account.provider}`
      )
    );
  }

  logger.info('Sequence email sent', {
    leadId: leadData.id,
    emailAccountId: emailConfig.emailAccountId,
    provider: account.provider,
    messageId,
  });

  return ok({ type: 'email', sent: true, messageId });
}

/**
 * Send email via Gmail with OAuth token refresh
 */
async function sendViaGmail(
  db: DbConnection,
  credentials: EmailCredentials,
  account: { id: string; tokenExpiresAt: Date | null },
  emailConfig: EmailNodeConfig,
  toEmail: string,
  subject: string,
  body: string
): Promise<string | undefined> {
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
        encryptedCredentials: encryptCredentials({
          accessToken: newTokens.accessToken,
          refreshToken: credentials.refreshToken,
        }),
        tokenExpiresAt: new Date(
          Date.now() + (newTokens.expiresIn || 3600) * 1000
        ),
      })
      .where(eq(emailAccount.id, account.id));
  }

  const gmailService = new GmailSendService(accessToken);
  const result = await gmailService.sendEmail({
    to: toEmail,
    subject,
    body,
    bodyType: 'html',
    replyTo: emailConfig.replyTo,
  });
  return result.messageId;
}

/**
 * Send email via Outlook with OAuth token refresh
 */
async function sendViaOutlook(
  db: DbConnection,
  credentials: EmailCredentials,
  account: { id: string; tokenExpiresAt: Date | null },
  emailConfig: EmailNodeConfig,
  toEmail: string,
  subject: string,
  body: string
): Promise<void> {
  let accessToken = credentials.accessToken;
  if (account.tokenExpiresAt && new Date() >= account.tokenExpiresAt) {
    const outlookOAuth = new OutlookOAuthService();
    const newTokens = await outlookOAuth.refreshAccessToken(
      credentials.refreshToken
    );
    accessToken = newTokens.accessToken;

    // Update the stored token (Microsoft returns new refresh token)
    await db
      .update(emailAccount)
      .set({
        encryptedCredentials: encryptCredentials({
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken || credentials.refreshToken,
        }),
        tokenExpiresAt: new Date(
          Date.now() + (newTokens.expiresIn || 3600) * 1000
        ),
      })
      .where(eq(emailAccount.id, account.id));
  }

  const outlookService = new OutlookSendService(accessToken);
  await outlookService.sendEmail({
    to: toEmail,
    subject,
    body,
    bodyType: 'html',
    replyTo: emailConfig.replyTo,
  });
}
