import { z } from 'zod';

export const generateAIResponseSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
  userMessage: z.string().min(1, 'User message is required'),
});

export type GenerateAIResponseInput = z.infer<typeof generateAIResponseSchema>;

/**
 * Structured response from the AI chatbot.
 */
export interface AIResponseResult {
  /** The message text to send to the user (may contain ---MSG_BREAK--- delimiters) */
  message: string;
  /** Optional action to take */
  action?: 'handoff' | 'silent_handoff' | 'end';
  /** Reason for silent handoff (logged internally, not shown to customer) */
  silentHandoffReason?: string;
  /** Notification message for the owner when using silent_handoff */
  ownerNotification?: string;
  /** Collected user data (name, email, phone, etc.) */
  collectedData?: Record<string, string>;
  /** Whether a website fetch was performed */
  usedWebsiteFetch?: boolean;
  /** Current conversation stage (v3.1 + legacy) */
  stage?:
    | 'first_contact'
    | 'qualified'
    | 'booking'
    | 'follow_up'
    | 'escalation'
    | 'enquiry'
    | 'interest'
    | 'stall';
  /** Treatments mentioned in this response */
  treatmentsMentioned?: string[];
  /** Whether a health concern was detected */
  healthConcernDetected?: boolean;
  /** Whether the customer expressed interest in booking */
  bookingInterest?: boolean;
  /** Whether the AI sent the booking link in this message */
  bookingLinkSent?: boolean;
  /** Whether the AI actively pushed/suggested booking in this message */
  bookingPushed?: boolean;

  /** Whether the customer asked about a service not in the knowledge base */
  needsFollowUp?: boolean;
  /** Description of what the customer asked about that needs follow-up */
  followUpReason?: string;

  /** Calendar tool: AI requests availability check */
  checkAvailability?: {
    date?: string;
    timePreference?: 'morning' | 'afternoon' | 'evening' | 'any';
  };
  /** Calendar tool: AI requests appointment booking */
  bookAppointment?: {
    date: string;
    time: string;
    customerName: string;
    customerPhone?: string;
  };

  /**
   * Set by the service when a `bookAppointment` request was actually written
   * to the diary. Absent means nothing was booked — there is no third,
   * "in progress" state, which is the whole of ENG-815.
   *
   * The caller uses it to record `directBookingConfirmedAt`, to cancel the
   * booking fallback, and to tell the post-processor that booking language in
   * this message is backed by a real appointment.
   */
  bookingCompleted?: {
    appointmentId: string;
    confirmationCode: string;
    slotIsoStart: string;
    displayTime: string;
  };

  /** Calendar tool: AI detects client wants to reschedule */
  rescheduleAppointment?: boolean;
  /** Calendar tool: AI confirms reschedule to a specific slot */
  confirmReschedule?: {
    appointmentId: string;
    newDate: string;
    newTime: string;
  };
}
