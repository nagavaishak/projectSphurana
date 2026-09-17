import { SNSSMSService } from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { type TestSmsInput, testSmsSchema } from './test-sms.schema.js';

export interface TestSmsResult {
  success: boolean;
  messageId?: string;
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

/**
 * Normalize phone number to E.164 format
 */
function normalizePhoneNumber(phone: string): string {
  // Remove all non-digit characters except leading +
  const cleaned = phone.replace(/[^\d+]/g, '');
  // Ensure it starts with +
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

const testSmsImpl = async (
  _db: DbConnection,
  input: TestSmsInput
): Promise<Result<TestSmsResult>> => {
  const parsed = testSmsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { to, message } = parsed.data;

  try {
    // Replace placeholders in message
    const processedMessage = replacePlaceholders(message);
    const normalizedPhone = normalizePhoneNumber(to);

    // Create SNS SMS service
    const smsService = new SNSSMSService();

    const result = await smsService.sendSMS({
      phoneNumber: normalizedPhone,
      message: processedMessage,
      smsType: 'Transactional',
    });

    return ok({
      success: result.success,
      messageId: result.messageId,
    });
  } catch (error) {
    logError('sequences.testSms', error, {
      feature: 'sequences',
      extra: { to },
    });

    const message =
      error instanceof Error ? error.message : 'Failed to send test SMS';
    return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, message));
  }
};

export const testSms = (db: DbConnection, input: TestSmsInput) =>
  trackedResult('sequences.testSms', () => testSmsImpl(db, input), {
    properties: { to: input.to },
  });

export type TestSmsServiceResult = Awaited<ReturnType<typeof testSms>>;
