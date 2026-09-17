import { z } from 'zod';

/**
 * Schema for Telnyx AI tool call request
 *
 * Telnyx sends tool calls with call_control_id and arguments (not parameters).
 * We accept conversation_id as the lookup key for the voiceCall record.
 */
export const voiceToolCallSchema = z.object({
  conversation_id: z.string().min(1, 'Conversation ID is required'),
  tool_call_id: z.string().min(1, 'Tool call ID is required'),
  tool_name: z.string().min(1, 'Tool name is required'),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export type VoiceToolCallInput = z.infer<typeof voiceToolCallSchema>;

/**
 * Response format for tool calls
 */
export interface VoiceToolCallResult {
  result: string;
}

// Tool-specific argument schemas
export const checkAvailabilityArgsSchema = z.object({
  date: z.string().optional(),
  time_preference: z
    .enum(['morning', 'afternoon', 'evening', 'any'])
    .optional(),
  service_type: z.string().optional(),
});

export type CheckAvailabilityArgs = z.infer<typeof checkAvailabilityArgsSchema>;

export const bookAppointmentArgsSchema = z.object({
  date: z.string(),
  time: z.string(),
  service_type: z.string(),
  customer_name: z.string(),
  customer_phone: z.string(),
  customer_email: z.string().optional(),
  notes: z.string().optional(),
});

export type BookAppointmentArgs = z.infer<typeof bookAppointmentArgsSchema>;

export const scheduleCallbackArgsSchema = z.object({
  preferred_time: z.string().optional(),
  reason: z.string().optional(),
});

export type ScheduleCallbackArgs = z.infer<typeof scheduleCallbackArgsSchema>;

export const transferToHumanArgsSchema = z.object({
  reason: z.string().optional(),
});

export type TransferToHumanArgs = z.infer<typeof transferToHumanArgsSchema>;
