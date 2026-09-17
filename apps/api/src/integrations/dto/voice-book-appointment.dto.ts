import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Schema for voice AI booking request
 * This is the payload format expected from ElevenLabs voice calls
 */
export const voiceBookAppointmentSchema = z.object({
  // Customer information
  customerName: z.string().min(1, 'Customer name is required'),
  customerPhone: z.string().optional(),
  customerEmail: z.string().email().optional(),

  // Appointment details
  title: z.string().min(1, 'Appointment title is required'),
  description: z.string().optional(),
  startDate: z.string().datetime({ message: 'Invalid start date format' }),
  endDate: z.string().datetime({ message: 'Invalid end date format' }),

  // Required: link to existing lead
  leadId: z.string().uuid({ message: 'Lead ID is required' }),

  // Required: who the appointment is assigned to
  assignedToId: z.string().uuid({ message: 'Assigned to ID is required' }),

  // Metadata from voice call
  conversationId: z.string().optional(),
  agentId: z.string().optional(),
});

export type VoiceBookAppointmentInput = z.infer<
  typeof voiceBookAppointmentSchema
>;

export class VoiceBookAppointmentDto extends createZodDto(
  voiceBookAppointmentSchema
) {}
