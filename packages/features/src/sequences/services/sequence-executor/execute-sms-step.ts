import { SNSSMSService } from '@borradh-workspace/integrations';
import { createLogger } from '@borradh-workspace/observability';
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
import { interpolateMessage } from './interpolate-message.js';
import type {
  ExecutionResultData,
  LeadData,
  SMSNodeConfig,
  SequenceStep,
} from './types.js';

const logger = createLogger('SequenceExecutor');

// SMS service instance (singleton)
const smsService = new SNSSMSService();

/**
 * Execute an SMS step
 */
export async function executeSmsStep(
  db: DbConnection,
  leadData: LeadData,
  step: SequenceStep,
  organizationId: string
): Promise<Result<ExecutionResultData>> {
  const smsConfig = step.config as unknown as SMSNodeConfig;

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
  if (!smsConfig.message) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_INPUT,
        'SMS step is missing message content'
      )
    );
  }

  // Deduct credits before sending
  const smsCreditResult = await useCredits(db, {
    organizationId,
    channel: 'sms' as CreditChannel,
    quantity: 1,
    referenceId: step.id,
    referenceType: 'sequence_step',
    description: `SMS to lead ${leadData.id}`,
  });

  if (!smsCreditResult.success) {
    logger.warn('Insufficient credits for SMS', {
      leadId: leadData.id,
      organizationId,
      error: smsCreditResult.error.code,
    });
    return err(
      new FeatureError(
        smsCreditResult.error.code === BillingErrorCodes.INSUFFICIENT_CREDITS
          ? ErrorCodes.FORBIDDEN
          : ErrorCodes.INTERNAL_ERROR,
        smsCreditResult.error.message
      )
    );
  }

  // Interpolate template variables
  const interpolatedMessage = interpolateMessage(smsConfig.message, leadData);

  // Send SMS via SNS
  const smsResult = await smsService.sendSMS({
    phoneNumber: leadData.phone,
    message: interpolatedMessage,
    senderId: smsConfig.from,
    smsType: 'Transactional',
  });

  return ok({
    type: 'sms',
    sent: smsResult.success,
    messageId: smsResult.messageId,
  });
}
