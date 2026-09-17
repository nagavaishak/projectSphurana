import { createHmac } from 'node:crypto';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type HandleWhatsAppWebhookInput,
  handleWhatsAppWebhookSchema,
} from './handle-whatsapp-webhook.schema.js';

const logger = createLogger('HandleWhatsAppWebhook');

export interface WhatsAppWebhookEvent {
  type: 'message' | 'status' | 'unknown';
  phoneNumberId?: string;
  from?: string;
  messageId?: string;
  timestamp?: number;
  body?: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
}

export interface HandleWhatsAppWebhookResult {
  processed: boolean;
  events: WhatsAppWebhookEvent[];
}

/**
 * Verify webhook signature using HMAC SHA256
 */
function verifySignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  if (!signature.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex');

  return signature === `sha256=${expectedSignature}`;
}

/**
 * Parse WhatsApp webhook payload
 */
function parseWebhookPayload(payload: string): WhatsAppWebhookEvent[] {
  const events: WhatsAppWebhookEvent[] = [];

  try {
    const data = JSON.parse(payload) as {
      object?: string;
      entry?: Array<{
        id?: string;
        changes?: Array<{
          field?: string;
          value?: {
            messaging_product?: string;
            metadata?: {
              phone_number_id?: string;
              display_phone_number?: string;
            };
            messages?: Array<{
              id?: string;
              from?: string;
              timestamp?: string;
              type?: string;
              text?: { body?: string };
            }>;
            statuses?: Array<{
              id?: string;
              recipient_id?: string;
              timestamp?: string;
              status?: string;
            }>;
          };
        }>;
      }>;
    };

    // Only process WhatsApp Business Account webhooks
    if (data.object !== 'whatsapp_business_account') {
      return events;
    }

    for (const entry of data.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        const phoneNumberId = value.metadata?.phone_number_id;

        // Process incoming messages
        for (const message of value.messages ?? []) {
          events.push({
            type: 'message',
            phoneNumberId,
            from: message.from,
            messageId: message.id,
            timestamp: message.timestamp
              ? Number.parseInt(message.timestamp, 10)
              : undefined,
            body: message.text?.body,
          });
        }

        // Process status updates
        for (const status of value.statuses ?? []) {
          events.push({
            type: 'status',
            phoneNumberId,
            from: status.recipient_id,
            messageId: status.id,
            timestamp: status.timestamp
              ? Number.parseInt(status.timestamp, 10)
              : undefined,
            status: status.status as 'sent' | 'delivered' | 'read' | 'failed',
          });
        }
      }
    }
  } catch (error) {
    logger.error('Failed to parse WhatsApp webhook payload', { error });
  }

  return events;
}

/**
 * Handle WhatsApp webhook
 *
 * Processes incoming WhatsApp webhook events:
 * - Verifies signature
 * - Parses message and status events
 * - Logs events for debugging
 *
 * Future enhancements:
 * - Store messages in conversation history
 * - Trigger auto-responses
 * - Update sequence enrollment status
 */
const handleWhatsAppWebhookImpl = async (
  _db: DbConnection,
  input: HandleWhatsAppWebhookInput,
  appSecret: string
): Promise<Result<HandleWhatsAppWebhookResult>> => {
  const parsed = handleWhatsAppWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { payload, signature } = parsed.data;

  // Verify signature
  if (!verifySignature(payload, signature, appSecret)) {
    logger.warn('WhatsApp webhook signature verification failed');
    return err(
      new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid webhook signature')
    );
  }

  // Parse events
  const events = parseWebhookPayload(payload);

  if (events.length === 0) {
    logger.debug('WhatsApp webhook received with no processable events');
    return ok({ processed: false, events: [] });
  }

  // Log events for debugging
  for (const event of events) {
    if (event.type === 'message') {
      logger.info('WhatsApp message received', {
        from: event.from,
        messageId: event.messageId,
        phoneNumberId: event.phoneNumberId,
        hasBody: !!event.body,
      });
    } else if (event.type === 'status') {
      logger.debug('WhatsApp status update', {
        status: event.status,
        messageId: event.messageId,
        recipient: event.from,
      });
    }
  }

  return ok({ processed: true, events });
};

/**
 * Handle WhatsApp webhook
 *
 * @param db - Database connection (reserved for future use)
 * @param input - Webhook payload and signature
 * @param appSecret - Meta app secret for signature verification
 * @returns Processed events
 *
 * @example
 * ```ts
 * const result = await handleWhatsAppWebhook(
 *   db,
 *   { payload: rawBody, signature: 'sha256=...' },
 *   process.env.META_APP_SECRET
 * );
 *
 * if (result.success) {
 *   console.log(`Processed ${result.data.events.length} events`);
 * }
 * ```
 */
export const handleWhatsAppWebhook = (
  db: DbConnection,
  input: HandleWhatsAppWebhookInput,
  appSecret: string
) =>
  trackedResult(
    'integrations.handleWhatsAppWebhook',
    () => handleWhatsAppWebhookImpl(db, input, appSecret),
    { properties: { hasSignature: !!input.signature } }
  );

export type HandleWhatsAppWebhookResponse = Awaited<
  ReturnType<typeof handleWhatsAppWebhook>
>;
