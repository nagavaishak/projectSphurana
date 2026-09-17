import { z } from 'zod';

export const evaluateReschedulePolicySchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
});

export type EvaluateReschedulePolicyInput = z.infer<
  typeof evaluateReschedulePolicySchema
>;

export interface RescheduleEvaluation {
  eligible: boolean;
  appointmentId?: string;
  appointmentTitle?: string;
  appointmentStartDate?: string;
  appointmentEndDate?: string;
  reason:
    | 'no_contact_info'
    | 'no_lead_found'
    | 'no_upcoming_appointment'
    | 'external_provider'
    | 'inside_notice_window'
    | 'eligible';
  noticeRequiredHours?: number;
  noShowFeeCents?: number | null;
  /** Pre-fetched slots when eligible (from checkAvailability) */
  availableSlots?: { displayTime: string; date: string }[];
  /** Human-readable context for the AI */
  contextMessage: string;
}
