/**
 * Follow-up sequence configuration and message generation.
 *
 * v4.1 follow-up sequence: 30min → 2hr → 20hr → dormant
 *
 * Rules:
 * - Follow-ups only trigger if the person has sent at least one message
 * - If the person replies at any point, the sequence stops
 * - Follow-up messages should not re-introduce Claire
 * - "x" should appear on maximum one of the three follow-ups
 * - Emoji should appear on maximum one of the three follow-ups
 * - Each follow-up must feel different from the others
 */

// v4.1 follow-up delays
export const FOLLOW_UP_DELAYS_MS: Record<number, number> = {
  0: 30 * 60 * 1000, // Follow-up 1: 30 minutes
  1: 2 * 60 * 60 * 1000, // Follow-up 2: 2 hours
  2: 20 * 60 * 60 * 1000, // Follow-up 3: 20 hours
};

export const MAX_FOLLOW_UPS = 3;

export const MSG_PART_DELAY_MS = 10_000; // 10 seconds between message parts

export const MAX_MESSAGE_PARTS = 4;

/**
 * Generate a stage-specific follow-up system prompt for the AI.
 */
export function getFollowUpMessage(stage: number, userName?: string): string {
  const name = userName ?? 'there';

  if (stage === 1) {
    // Follow-up 1 (30 minutes): Light check-in. No booking link. No booking push.
    return `[SYSTEM: Follow-up 1 of 3. The customer hasn't replied for about 30 minutes. Send a casual, light check-in. Their name is "${name}".

RULES FOR THIS MESSAGE:
- Keep it to 1-2 sentences max.
- Do NOT include the booking link.
- Do NOT push to book or mention consultations.
- Just a gentle nudge to see if they have questions.
- Do NOT use "x" on this message.
- Do NOT use emoji on this message.
- Do NOT re-introduce yourself.

Example: "Just checking in ${name}, did you have any other questions? Happy to help with anything"
Alternative: "No rush at all, just wanted to check if you had any questions about the treatment?"]`;
  }

  if (stage === 2) {
    // Follow-up 2 (2 hours): Warmer, mention consultation as option. Can include booking link.
    return `[SYSTEM: Follow-up 2 of 3. The customer hasn't replied for about 2 hours. Send a slightly warmer follow-up. Their name is "${name}".

RULES FOR THIS MESSAGE:
- Keep it to 2-3 sentences max.
- You CAN include the booking link in this message.
- Frame the consultation as no pressure, no commitment.
- Reference the team naturally.
- You can use "x" on this message if it feels natural.
- Do NOT use emoji on this message.
- Do NOT re-introduce yourself.

Example: "Hey ${name} just wanted to follow up, our team would love to look after you if you're interested. No pressure at all, just let me know if you'd like to book a consultation or if you have any questions"
Alternative: "Hi again, just didn't want you to miss out. If you'd like to come in for a chat with our specialist there's no commitment, they can go through everything with you and answer any questions x"]`;
  }

  // Follow-up 3 (20 hours): Final message. Leave the door open. Then stop.
  return `[SYSTEM: Follow-up 3 of 3 (FINAL). The customer hasn't replied for about 20 hours. This is your LAST message ever. Their name is "${name}".

RULES FOR THIS MESSAGE:
- Keep it to 1-2 sentences max.
- Keep it casual and warm. No pressure.
- Make it clear this is the last check-in.
- Leave the door open for them to reach out anytime.
- You can use "x" on this message if you didn't use it on follow-up 2.
- Do NOT use emoji on this message.
- Do NOT re-introduce yourself.
- After this message, the conversation will be marked dormant. No more messages will be sent.

Example: "Last one from me! If you ever want to get booked in or have any questions at all just send me a message anytime. Hope to hear from you x"
Alternative: "Hey ${name}, just a final check in. Whenever you're ready our team is here for you. No rush at all, just drop me a message anytime"]`;
}
