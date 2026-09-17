import { lead, voiceCall } from '@borradh-workspace/database';
import {
  analyzeCallOutcome,
  extractCrmUpdateData,
  inferSentiment,
  parseTelnyxWebhookEvent,
  verifyTelnyxWebhookSignature,
} from '@borradh-workspace/integrations';
import type { TelnyxWebhookEvent } from '@borradh-workspace/integrations';
import type { LeadStatus } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { parseCallbackTime } from '../handle-voice-tool-call/parse-callback-time.js';
import {
  type HandleVoiceWebhookInput,
  handleVoiceWebhookSchema,
} from './handle-voice-webhook.schema.js';

interface WebhookResult {
  event: string;
  callControlId: string;
  processed: boolean;
  outcome?: string;
  leadUpdated?: boolean;
}

const handleVoiceWebhookImpl = async (
  db: DbConnection,
  input: HandleVoiceWebhookInput,
  webhookPublicKey: string
): Promise<Result<WebhookResult>> => {
  const parsed = handleVoiceWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { payload, signature, timestamp } = parsed.data;

  // Verify Telnyx webhook signature (Ed25519)
  const isValid = await verifyTelnyxWebhookSignature(
    payload,
    signature,
    timestamp,
    webhookPublicKey
  );

  if (!isValid) {
    return err(
      new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid webhook signature')
    );
  }

  // Parse the webhook event
  let event: TelnyxWebhookEvent;
  try {
    event = parseTelnyxWebhookEvent(JSON.parse(payload));
  } catch (error) {
    logError('voice.handleVoiceWebhook.parse', error, {
      feature: 'voice',
    });
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid webhook payload')
    );
  }

  try {
    switch (event.data.event_type) {
      case 'conversation.ended': {
        const eventPayload = event.data.payload;
        const callControlId = eventPayload.call_control_id;
        const result: WebhookResult = {
          event: event.data.event_type,
          callControlId,
          processed: true,
        };

        // Handle combined call_ended + call_analyzed logic
        await handleConversationEnded(db, eventPayload);

        const outcome = analyzeCallOutcome(eventPayload);
        result.outcome = outcome.outcome;

        // Update lead based on analysis
        result.leadUpdated = await handleCallAnalysis(db, eventPayload);

        return ok(result);
      }

      case 'call.initiation.failed': {
        const eventPayload = event.data.payload;
        const callControlId = eventPayload.call_control_id ?? 'unknown';
        const result: WebhookResult = {
          event: event.data.event_type,
          callControlId,
          processed: true,
        };

        await handleCallInitiationFailed(db, eventPayload);

        return ok(result);
      }
    }
  } catch (error) {
    const callControlId =
      event.data.event_type === 'conversation.ended'
        ? event.data.payload.call_control_id
        : (event.data.payload.call_control_id ?? 'unknown');

    logError('voice.handleVoiceWebhook.process', error, {
      feature: 'voice',
      extra: { event: event.data.event_type, callControlId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to process webhook')
    );
  }
};

/**
 * Handle conversation.ended event — update voice call record with call data
 *
 * Telnyx sends a single webhook after the call with transcript + analysis.
 */
async function handleConversationEnded(
  db: DbConnection,
  payload: Extract<
    TelnyxWebhookEvent,
    { data: { event_type: 'conversation.ended' } }
  >['data']['payload']
): Promise<void> {
  const outcome = analyzeCallOutcome(payload);
  const sentiment = inferSentiment(payload);
  const crmData = extractCrmUpdateData(payload);

  const transcriptText = payload.transcript
    .map(
      (entry) =>
        `${entry.role === 'assistant' ? 'agent' : 'user'}: ${entry.content}`
    )
    .join('\n');

  const durationMs = payload.duration_seconds * 1000;
  const endedAt = new Date(payload.end_time);

  // Look up voiceCall by call_control_id (stored as the voiceCall.id)
  await db
    .update(voiceCall)
    .set({
      status: payload.status === 'error' ? 'failed' : 'completed',
      endedAt,
      durationMs,
      outcome: outcome.outcome,
      transcript: transcriptText,
      aiSummary: payload.analysis?.summary ?? null,
      sentiment: sentiment as
        | 'Positive'
        | 'Negative'
        | 'Neutral'
        | 'Unknown'
        | null,
      appointmentBooked: crmData.appointmentBooked,
      appointmentDetails: crmData.appointmentDetails,
      callbackRequested: crmData.callbackRequested,
      callbackTime: crmData.callbackTime,
    })
    .where(eq(voiceCall.id, payload.call_control_id));
}

/**
 * Handle call analysis — update lead status based on call outcome
 */
async function handleCallAnalysis(
  db: DbConnection,
  payload: Extract<
    TelnyxWebhookEvent,
    { data: { event_type: 'conversation.ended' } }
  >['data']['payload']
): Promise<boolean> {
  const crmData = extractCrmUpdateData(payload);

  // Reinforce callback time on lead if callback was requested
  if (crmData.callbackRequested && crmData.callbackTime && crmData.leadId) {
    const callbackDate = parseCallbackTime(crmData.callbackTime);
    if (callbackDate) {
      const currentLead = await db.query.lead.findFirst({
        where: and(eq(lead.id, crmData.leadId), notDeleted(lead)),
        columns: { nextActionAt: true },
      });
      // Only override if callback is later than current nextActionAt
      if (
        !currentLead?.nextActionAt ||
        callbackDate > currentLead.nextActionAt
      ) {
        await db
          .update(lead)
          .set({ nextActionAt: callbackDate })
          .where(and(eq(lead.id, crmData.leadId), notDeleted(lead)));
      }
    }
  }

  // Update lead if we have a lead ID
  if (crmData.leadId) {
    // Check for negative sentiment → trigger human takeover
    if (crmData.sentiment === 'Negative') {
      await db
        .update(lead)
        .set({
          humanTakeoverRequested: true,
          humanTakeoverReason: 'Negative sentiment detected during call',
          humanTakeoverAt: new Date(),
          sequenceStatus: 'paused',
          notes: crmData.aiSummary
            ? `Voice call summary: ${crmData.aiSummary}`
            : undefined,
        })
        .where(and(eq(lead.id, crmData.leadId), notDeleted(lead)));

      return true;
    }

    // Determine new lead status based on call outcome
    let newStatus: string | undefined;
    switch (crmData.outcome) {
      case 'booked':
        newStatus = 'booked';
        break;
      case 'interested':
      case 'callback_scheduled':
        newStatus = 'contacted';
        break;
      case 'not_interested':
        newStatus = 'lost';
        break;
    }

    if (newStatus) {
      await db
        .update(lead)
        .set({
          status: newStatus as LeadStatus,
          notes: crmData.aiSummary
            ? `Voice call summary: ${crmData.aiSummary}`
            : undefined,
        })
        .where(and(eq(lead.id, crmData.leadId), notDeleted(lead)));
    }

    return true;
  }

  return false;
}

/**
 * Handle call.initiation.failed event — mark voiceCall as failed
 */
async function handleCallInitiationFailed(
  db: DbConnection,
  payload: Extract<
    TelnyxWebhookEvent,
    { data: { event_type: 'call.initiation.failed' } }
  >['data']['payload']
): Promise<void> {
  if (payload.call_control_id) {
    await db
      .update(voiceCall)
      .set({
        status: 'failed',
        disconnectionReason: payload.error,
      })
      .where(eq(voiceCall.id, payload.call_control_id));
  }
}

/**
 * Handle Telnyx AI webhook events
 *
 * Processes conversation.ended and call.initiation.failed events.
 * Updates voice call records and lead status based on call outcomes.
 *
 * @param db - Database connection
 * @param input - Webhook payload, signature, and timestamp
 * @param webhookPublicKey - Telnyx Ed25519 public key for signature verification
 * @returns Result with webhook processing status
 */
export const handleVoiceWebhook = (
  db: DbConnection,
  input: HandleVoiceWebhookInput,
  webhookPublicKey: string
) =>
  trackedResult(
    'voice.handleVoiceWebhook',
    () => handleVoiceWebhookImpl(db, input, webhookPublicKey),
    { properties: { hasSignature: !!input.signature } }
  );

export type HandleVoiceWebhookResult = Awaited<
  ReturnType<typeof handleVoiceWebhook>
>;
