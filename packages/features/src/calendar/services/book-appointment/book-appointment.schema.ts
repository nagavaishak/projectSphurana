import { z } from 'zod';

export const bookAppointmentSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /**
   * Lead ID for the appointment
   */
  leadId: z.string().min(1, 'Lead ID is required'),
  /**
   * User ID who will be assigned to the appointment
   */
  assignedToId: z.string().min(1, 'Assigned user ID is required'),
  /**
   * Practitioner ID if booking with a specific practitioner
   */
  practitionerId: z.string().optional(),
  /**
   * Date in YYYY-MM-DD format
   */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  /**
   * Time in HH:MM format (24-hour)
   */
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  /**
   * Duration of appointment in minutes
   */
  duration: z.number().int().min(15).max(480).optional(),
  /**
   * Service type / appointment title
   */
  serviceType: z.string().min(1, 'Service type is required'),
  /**
   * Customer's name for the appointment
   */
  customerName: z.string().min(1, 'Customer name is required'),
  /**
   * Customer's phone number
   */
  customerPhone: z.string().min(1, 'Customer phone is required'),
  /**
   * Customer's email (optional)
   */
  customerEmail: z.string().email().optional(),
  /**
   * Additional notes for the appointment
   */
  notes: z.string().optional(),
  /**
   * Source of the booking (e.g., ai_voice_caller, booking_form)
   */
  source: z
    .enum(['manual', 'ai_voice_caller', 'calendar_sync', 'booking_form'])
    .optional()
    .default('ai_voice_caller'),
});

export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;

export interface BookAppointmentResult {
  /**
   * Whether the booking was successful
   */
  success: boolean;
  /**
   * Appointment ID in the database
   */
  appointmentId: string;
  /**
   * Confirmation code / reference
   */
  confirmationCode: string;
  /**
   * Booked date
   */
  date: string;
  /**
   * Booked time (display format)
   */
  time: string;
  /**
   * Service type booked
   */
  serviceType: string;
  /**
   * External calendar event ID (if synced)
   */
  externalEventId?: string;
  /**
   * Message for voice agent to speak
   */
  message: string;
}
