import { z } from 'zod';

/**
 * The payload the voice AI (ElevenLabs) posts when a customer books during a
 * call. Mirrors the entry point's `VoiceBookAppointmentDto` — that DTO stays
 * where it is because the global `ZodValidationPipe` needs a `createZodDto`
 * class, and it is what actually validates the request. This schema is the
 * use case's own contract for the same shape, so the service is callable (and
 * testable) without an HTTP request.
 */
export const bookVoiceAppointmentSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),

  customerName: z.string().min(1, 'Customer name is required'),
  customerPhone: z.string().optional(),
  customerEmail: z.string().optional(),

  title: z.string().min(1, 'Appointment title is required'),
  description: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),

  leadId: z.string(),
  assignedToId: z.string(),

  conversationId: z.string().optional(),
  agentId: z.string().optional(),
});

export type BookVoiceAppointmentInput = z.infer<
  typeof bookVoiceAppointmentSchema
>;
