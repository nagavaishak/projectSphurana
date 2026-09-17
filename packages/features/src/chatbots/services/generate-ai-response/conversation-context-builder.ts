import type { ConversationMetadata } from '@borradh-workspace/database';

export interface ReturningSenderContext {
  totalMessages: number;
  firstContactDate: Date;
  daysSinceFirstContact: number;
}

/**
 * Build conversation memory context to prepend to the user prompt.
 * Gives the AI awareness of what it already knows about this lead.
 */
export function buildConversationContext(
  metadata: ConversationMetadata | null | undefined,
  returningSender?: ReturningSenderContext | null
): string {
  if (!metadata) return '';

  const contextLines: string[] = [];

  if (metadata.stage) {
    contextLines.push(`Current stage: ${metadata.stage}`);
  }
  if (metadata.name) {
    const firstName = metadata.name.split(/\s+/)[0] ?? metadata.name;
    contextLines.push(
      `Customer first name: ${firstName} (USE ONLY THIS FIRST NAME in every response — never their full name or surname)`
    );
  }
  if (metadata.phone) {
    contextLines.push(`Customer phone: ${metadata.phone}`);
  }
  if (metadata.treatmentsDiscussed && metadata.treatmentsDiscussed.length > 0) {
    contextLines.push(
      `Treatments discussed: ${metadata.treatmentsDiscussed.join(', ')}`
    );
  }
  if (metadata.healthConcerns && metadata.healthConcerns.length > 0) {
    contextLines.push(
      `Health concerns noted: ${metadata.healthConcerns.join(', ')}`
    );
  }
  if (metadata.bookingLinkSent) {
    contextLines.push(
      'Booking link was already sent earlier in this conversation. Do not resend it unless the customer asks for it again.'
    );
  }
  if (metadata.bookingInterest) {
    contextLines.push('Customer has expressed interest in booking');
  }
  if (metadata.bookingPushCount && metadata.bookingPushCount >= 2) {
    contextLines.push(
      'Booking push cap reached (2/2). Do not suggest booking again. Just answer their questions naturally and be helpful. Only send the booking link if the customer explicitly asks to book (e.g. "how do I book?", "can I book?", "I want to come in", "when are you free?", "yeah let\'s do it"). Set bookingPushed to false unless they ask to book.'
    );
  } else if (metadata.bookingPushCount === 1) {
    contextLines.push(
      'Booking push count: 1/2. You may suggest booking ONE more time at a natural moment after you have answered a few more questions and built rapport. Do NOT suggest booking in this next message if you pushed in the last one — leave at least one message gap. When you do push, weave it naturally into your answer.'
    );
  }
  if (metadata.contactDetailAsks && metadata.contactDetailAsks >= 2) {
    contextLines.push('Contact details already asked twice, do NOT ask again');
  }
  if (metadata.followUpStage) {
    contextLines.push(`Follow-up stage: ${metadata.followUpStage} of 3`);
  }
  if (metadata.dormant) {
    contextLines.push('Conversation is dormant (3 follow-ups sent, no reply)');
  }
  if (metadata.adTitle) {
    contextLines.push(
      `Customer came from ad: "${metadata.adTitle}" — when they ask about pricing, cost, or details without specifying a treatment, ASSUME they mean ${metadata.adTitle} and answer directly (e.g. "for our ${metadata.adTitle.toLowerCase()}, ..."). Do NOT ask them to confirm which treatment they mean. If they later ask about a different service, help them with that instead.`
    );
  }

  if (returningSender && returningSender.totalMessages > 0) {
    contextLines.push(
      `Returning sender: This person has contacted you before. They have sent ${returningSender.totalMessages} previous messages over ${returningSender.daysSinceFirstContact} days.`
    );
  }

  if (contextLines.length === 0) return '';

  return `\n--- Conversation Memory ---\n${contextLines.join('\n')}\n`;
}
