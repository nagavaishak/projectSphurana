import { createLogger, redactPII } from '@borradh-workspace/observability';
import type { AIResponseResult } from './generate-ai-response.schema.js';

const logger = createLogger('ParseAIResponse');

/**
 * Parse the AI response JSON, with fallback for non-JSON responses.
 *
 * @param content - Raw LLM output
 * @param conversationId - Optional, used for diagnostic logs on parse failure
 */
export function parseAIResponse(
  content: string,
  conversationId?: string
): AIResponseResult {
  try {
    const parsed = JSON.parse(content);
    return {
      message: parsed.message ?? content,
      action: parsed.action ?? undefined,
      collectedData: parsed.collectedData ?? undefined,
      silentHandoffReason: parsed.silentHandoffReason ?? undefined,
      ownerNotification: parsed.ownerNotification ?? undefined,
      usedWebsiteFetch: false,
      stage: parsed.stage ?? undefined,
      treatmentsMentioned: parsed.treatmentsMentioned ?? undefined,
      healthConcernDetected: parsed.healthConcernDetected ?? undefined,
      bookingInterest: parsed.bookingInterest ?? undefined,
      bookingLinkSent: parsed.bookingLinkSent ?? undefined,
      bookingPushed: parsed.bookingPushed ?? undefined,
      needsFollowUp: parsed.needsFollowUp ?? undefined,
      followUpReason: parsed.followUpReason ?? undefined,
      checkAvailability: parsed.checkAvailability ?? undefined,
      bookAppointment: parsed.bookAppointment ?? undefined,
      rescheduleAppointment: parsed.rescheduleAppointment ?? undefined,
      confirmReschedule: parsed.confirmReschedule ?? undefined,
    };
  } catch (err) {
    // If the AI didn't return valid JSON, use the raw text but log it —
    // historically this path was silent and we couldn't see how often
    // the LLM was producing non-JSON output.
    logger.warn('AI response was not valid JSON, using raw text', {
      reason: 'ai_response_not_json',
      conversationId,
      contentLength: content?.length ?? 0,
      contentPreview: redactPII(content ?? '').slice(0, 200),
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      message: content,
      usedWebsiteFetch: false,
    };
  }
}
