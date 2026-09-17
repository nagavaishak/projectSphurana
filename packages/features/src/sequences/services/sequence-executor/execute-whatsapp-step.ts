import { whatsappAccount } from '@borradh-workspace/database';
import {
  WhatsAppCloudService,
  decryptCredentials,
} from '@borradh-workspace/integrations';
import { createLogger } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { BillingErrorCodes } from '../../../billing/models/billing-error.types.js';
import type { CreditChannel } from '../../../billing/models/billing.types.js';
import { useCredits } from '../../../billing/services/use-credits/use-credits.service.js';
import { handleWhatsAppError } from '../../../meta-ads/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { interpolateMessage } from './interpolate-message.js';
import type {
  ExecutionResultData,
  LeadData,
  SequenceStep,
  WhatsAppNodeConfig,
} from './types.js';

const logger = createLogger('SequenceExecutor');

/**
 * Execute a WhatsApp step
 */
export async function executeWhatsAppStep(
  db: DbConnection,
  leadData: LeadData,
  step: SequenceStep,
  organizationId: string
): Promise<Result<ExecutionResultData>> {
  const whatsappConfig = step.config as unknown as WhatsAppNodeConfig;

  // Validate phone number exists
  if (!leadData.phone) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_INPUT,
        'Lead does not have a phone number'
      )
    );
  }

  // Validate message exists
  if (!whatsappConfig.message) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_INPUT,
        'WhatsApp step is missing message content'
      )
    );
  }

  // Look up active WhatsApp account for this organization
  const waAccount = await db.query.whatsappAccount.findFirst({
    where: and(
      eq(whatsappAccount.organizationId, organizationId),
      eq(whatsappAccount.isActive, true)
    ),
  });

  if (!waAccount) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'No active WhatsApp account found for this organization'
      )
    );
  }

  // Deduct credits before sending
  const whatsappCreditResult = await useCredits(db, {
    organizationId,
    channel: 'whatsapp' as CreditChannel,
    quantity: 1,
    referenceId: step.id,
    referenceType: 'sequence_step',
    description: `WhatsApp to lead ${leadData.id}`,
  });

  if (!whatsappCreditResult.success) {
    logger.warn('Insufficient credits for WhatsApp', {
      leadId: leadData.id,
      organizationId,
      error: whatsappCreditResult.error.code,
    });
    return err(
      new FeatureError(
        whatsappCreditResult.error.code ===
          BillingErrorCodes.INSUFFICIENT_CREDITS
          ? ErrorCodes.FORBIDDEN
          : ErrorCodes.INTERNAL_ERROR,
        whatsappCreditResult.error.message
      )
    );
  }

  try {
    // Interpolate template variables
    const interpolatedMessage = interpolateMessage(
      whatsappConfig.message,
      leadData
    );

    // Decrypt credentials and send via WhatsApp Cloud API
    const credentials = decryptCredentials<{ accessToken: string }>(
      waAccount.encryptedCredentials
    );
    const whatsapp = new WhatsAppCloudService(
      credentials.accessToken,
      waAccount.phoneNumberId
    );
    const waResult = await whatsapp.sendTextMessage(
      leadData.phone,
      interpolatedMessage
    );

    return ok({
      type: 'whatsapp',
      sent: true,
      messageId: waResult.messageId,
    });
  } catch (error) {
    return handleWhatsAppError(error, {
      operationName: 'sequences.executeWhatsApp',
      extra: { leadId: leadData.id, organizationId },
      defaultErrorCode: ErrorCodes.EXTERNAL_SERVICE_ERROR,
      defaultUserTitle: 'Failed to Send WhatsApp Message',
      db,
      organizationId,
    });
  }
}
