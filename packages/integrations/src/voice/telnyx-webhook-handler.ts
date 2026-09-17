/**
 * Telnyx AI Webhook Handler
 *
 * Handles webhook events from Telnyx AI Assistants for post-call events.
 * Telnyx sends conversation.ended and call.initiation.failed webhooks.
 *
 * Telnyx uses Ed25519 signature verification (not HMAC).
 *
 * @see https://developers.telnyx.com/docs/webhooks
 */

import type {
  CallInitiationFailedWebhook,
  ConversationEndedWebhook,
  TelnyxToolCallEntry,
  TelnyxWebhookEvent,
} from './telnyx-ai.types.js';

// ============================================================================
// Webhook Verification
// ============================================================================

/**
 * Verify Telnyx webhook signature (Ed25519)
 *
 * Telnyx signs webhooks with Ed25519. The signature and timestamp are
 * sent in headers. The signed payload is `timestamp|payload`.
 *
 * @param payload - Raw request body as string
 * @param signature - telnyx-signature-ed25519 header value (base64)
 * @param timestamp - telnyx-timestamp header value
 * @param publicKey - Telnyx webhook public key (base64)
 * @returns true if signature is valid
 */
export async function verifyTelnyxWebhookSignature(
  payload: string,
  signature: string,
  timestamp: string,
  publicKey: string
): Promise<boolean> {
  try {
    // Import the Ed25519 public key
    const keyBytes = Buffer.from(publicKey, 'base64');
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    // The signed content is timestamp|payload
    const signedContent = `${timestamp}|${payload}`;
    const signatureBytes = Buffer.from(signature, 'base64');
    const contentBytes = new TextEncoder().encode(signedContent);

    return crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      signatureBytes,
      contentBytes
    );
  } catch {
    return false;
  }
}

// ============================================================================
// Webhook Event Parsing
// ============================================================================

/**
 * Parse and validate a webhook event from Telnyx
 */
export function parseTelnyxWebhookEvent(payload: unknown): TelnyxWebhookEvent {
  if (!isValidTelnyxPayload(payload)) {
    throw new Error('Invalid Telnyx webhook payload structure');
  }

  const event = payload as TelnyxWebhookEvent;
  const eventType = event.data.event_type;

  switch (eventType) {
    case 'conversation.ended':
    case 'call.initiation.failed':
      return event;
    default:
      throw new Error(`Unknown Telnyx webhook event type: ${eventType}`);
  }
}

function isValidTelnyxPayload(payload: unknown): payload is TelnyxWebhookEvent {
  if (typeof payload !== 'object' || payload === null) return false;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.data !== 'object' || obj.data === null) return false;
  const data = obj.data as Record<string, unknown>;
  return typeof data.event_type === 'string';
}

// ============================================================================
// Webhook Event Handlers
// ============================================================================

/**
 * Handler interface for processing Telnyx webhook events
 */
export interface TelnyxWebhookEventHandlers {
  onConversationEnded?: (event: ConversationEndedWebhook) => Promise<void>;
  onCallInitiationFailed?: (
    event: CallInitiationFailedWebhook
  ) => Promise<void>;
}

/**
 * Process a Telnyx webhook event with the provided handlers
 */
export async function processTelnyxWebhookEvent(
  event: TelnyxWebhookEvent,
  handlers: TelnyxWebhookEventHandlers
): Promise<void> {
  switch (event.data.event_type) {
    case 'conversation.ended':
      await handlers.onConversationEnded?.(event as ConversationEndedWebhook);
      break;
    case 'call.initiation.failed':
      await handlers.onCallInitiationFailed?.(
        event as CallInitiationFailedWebhook
      );
      break;
  }
}

// ============================================================================
// Call Outcome Analysis
// ============================================================================

/**
 * Determine call outcome category from Telnyx post-call data
 */
export type CallOutcome =
  | 'booked'
  | 'callback_scheduled'
  | 'interested'
  | 'not_interested'
  | 'no_answer'
  | 'error'
  | 'unknown';

export interface CallOutcomeResult {
  outcome: CallOutcome;
  confidence: 'high' | 'medium' | 'low';
  details: {
    bookedAppointment?: {
      date?: string;
      time?: string;
      service?: string;
    };
    callbackRequested?: boolean;
    callbackTime?: string;
    leadSentiment?: 'Positive' | 'Negative' | 'Neutral' | 'Unknown';
    duration?: number;
    transcript?: string;
  };
}

/**
 * Analyze a completed call to determine the outcome from Telnyx data
 */
export function analyzeCallOutcome(
  payload: ConversationEndedWebhook['data']['payload']
): CallOutcomeResult {
  const { transcript, duration_seconds, analysis } = payload;

  const durationMs = duration_seconds * 1000;
  const transcriptText = transcript
    .map(
      (entry) =>
        `${entry.role === 'assistant' ? 'agent' : 'user'}: ${entry.content}`
    )
    .join('\n');

  const details: CallOutcomeResult['details'] = {
    duration: durationMs,
    transcript: transcriptText,
  };

  // Check for errors - very short calls are likely failed
  if (payload.status === 'error' || duration_seconds < 3) {
    return {
      outcome: durationMs === 0 ? 'no_answer' : 'error',
      confidence: 'high',
      details,
    };
  }

  // Extract all tool calls from transcript
  const allToolCalls: TelnyxToolCallEntry[] = transcript.flatMap(
    (entry) => entry.tool_calls ?? []
  );

  const bookingCall = allToolCalls.find((tc) =>
    tc.tool_name.toLowerCase().includes('book_appointment')
  );

  const callbackCall = allToolCalls.find((tc) =>
    tc.tool_name.toLowerCase().includes('schedule_callback')
  );

  if (bookingCall?.result?.toLowerCase().includes('success')) {
    const args = bookingCall.arguments as Record<string, unknown>;
    details.bookedAppointment = {
      date: args.date as string,
      time: args.time as string,
      service: args.service_type as string,
    };

    return {
      outcome: 'booked',
      confidence: 'high',
      details,
    };
  }

  if (callbackCall) {
    details.callbackRequested = true;
    const args = callbackCall.arguments as Record<string, unknown>;
    details.callbackTime = args.preferred_time as string;

    return {
      outcome: 'callback_scheduled',
      confidence: 'high',
      details,
    };
  }

  // Analyze based on Telnyx analysis
  if (analysis) {
    if (analysis.call_successful) {
      return {
        outcome: 'interested',
        confidence: 'medium',
        details,
      };
    }
  }

  // Analyze sentiment from transcript keywords
  const lowerTranscript = transcriptText.toLowerCase();

  if (
    lowerTranscript.includes("i'll book") ||
    lowerTranscript.includes('appointment confirmed') ||
    lowerTranscript.includes("you're all set")
  ) {
    return {
      outcome: 'booked',
      confidence: 'low',
      details,
    };
  }

  if (
    lowerTranscript.includes('not interested') ||
    lowerTranscript.includes('no thank you') ||
    lowerTranscript.includes("don't call")
  ) {
    details.leadSentiment = 'Negative';
    return {
      outcome: 'not_interested',
      confidence: 'low',
      details,
    };
  }

  return {
    outcome: 'unknown',
    confidence: 'low',
    details,
  };
}

/**
 * Infer sentiment from Telnyx transcript and analysis data
 */
export function inferSentiment(
  payload: ConversationEndedWebhook['data']['payload']
): 'Positive' | 'Negative' | 'Neutral' | 'Unknown' {
  const { analysis, transcript } = payload;

  if (analysis?.call_successful) {
    return 'Positive';
  }

  const lowerTranscript = transcript
    .map((e) => e.content)
    .join(' ')
    .toLowerCase();

  if (
    lowerTranscript.includes('not interested') ||
    lowerTranscript.includes("don't call") ||
    lowerTranscript.includes('stop calling') ||
    lowerTranscript.includes('frustrated')
  ) {
    return 'Negative';
  }

  if (
    lowerTranscript.includes('thank you') ||
    lowerTranscript.includes('sounds great') ||
    lowerTranscript.includes('interested')
  ) {
    return 'Positive';
  }

  return 'Neutral';
}

// ============================================================================
// Webhook Response Helpers
// ============================================================================

/**
 * Create a successful webhook response
 */
export function createWebhookResponse(statusCode: 200 | 201 = 200): {
  statusCode: number;
  body: string;
} {
  return {
    statusCode,
    body: JSON.stringify({ success: true }),
  };
}

/**
 * Create an error webhook response
 */
export function createWebhookErrorResponse(
  message: string,
  statusCode: 400 | 401 | 500 = 500
): { statusCode: number; body: string } {
  return {
    statusCode,
    body: JSON.stringify({ success: false, error: message }),
  };
}

// ============================================================================
// Call Summary Helpers
// ============================================================================

/**
 * Generate a human-readable summary of the call from Telnyx data
 */
export function generateCallSummary(
  payload: ConversationEndedWebhook['data']['payload']
): string {
  const outcome = analyzeCallOutcome(payload);
  const durationMinutes = Math.floor(payload.duration_seconds / 60);
  const remainingSeconds = Math.round(payload.duration_seconds % 60);

  let summary = `Call (session: ${payload.call_session_id})\n`;
  summary += `Duration: ${durationMinutes}:${remainingSeconds.toString().padStart(2, '0')}\n`;
  summary += `Outcome: ${outcome.outcome} (${outcome.confidence} confidence)\n`;

  if (outcome.details.bookedAppointment) {
    const { date, time, service } = outcome.details.bookedAppointment;
    summary += `Appointment: ${service ?? 'Service'} on ${date} at ${time}\n`;
  }

  if (outcome.details.callbackRequested) {
    summary += `Callback requested: ${outcome.details.callbackTime ?? 'Time TBD'}\n`;
  }

  if (payload.analysis?.summary) {
    summary += `\nAI Summary: ${payload.analysis.summary}`;
  }

  return summary;
}

/**
 * CRM update data extracted from call
 */
export interface CrmUpdateData {
  leadId: string;
  callControlId: string;
  callSessionId: string;
  outcome: CallOutcome;
  sentiment: string | null;
  appointmentBooked: boolean;
  appointmentDetails: {
    date?: string;
    time?: string;
    service?: string;
  } | null;
  callbackRequested: boolean;
  callbackTime: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  aiSummary: string | null;
  duration: number | null;
  calledAt: Date;
}

/**
 * Extract CRM-ready data from Telnyx post-call webhook
 */
export function extractCrmUpdateData(
  payload: ConversationEndedWebhook['data']['payload']
): CrmUpdateData {
  const outcome = analyzeCallOutcome(payload);
  const sentiment = inferSentiment(payload);

  // Extract leadId from dynamic variables passed at call initiation
  const dynamicVars = payload.dynamic_variables as Record<
    string,
    unknown
  > | null;
  const leadId = (dynamicVars?.__leadId as string) ?? '';

  return {
    leadId,
    callControlId: payload.call_control_id,
    callSessionId: payload.call_session_id,
    outcome: outcome.outcome,
    sentiment,
    appointmentBooked: outcome.outcome === 'booked',
    appointmentDetails: outcome.details.bookedAppointment ?? null,
    callbackRequested: outcome.details.callbackRequested ?? false,
    callbackTime: outcome.details.callbackTime ?? null,
    transcript: outcome.details.transcript ?? null,
    recordingUrl: null,
    aiSummary: payload.analysis?.summary ?? null,
    duration:
      payload.duration_seconds != null ? payload.duration_seconds * 1000 : null,
    calledAt: new Date(payload.start_time),
  };
}
