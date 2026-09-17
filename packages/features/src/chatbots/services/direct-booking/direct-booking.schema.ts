import { z } from 'zod';

export const DEFAULT_BOOKING_FALLBACK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const DEFAULT_SLOTS_TO_OFFER = 3;
export const DEFAULT_DAYS_AHEAD = 7;

/**
 * Schema for checking if booking link was ignored
 */
export const checkBookingLinkIgnoredSchema = z.object({
  conversationId: z.string().min(1),
  organizationId: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
});

export type CheckBookingLinkIgnoredInput = z.input<
  typeof checkBookingLinkIgnoredSchema
>;

/**
 * Schema for offering booking slots to lead
 */
export const offerBookingSlotsSchema = z.object({
  conversationId: z.string().min(1),
  organizationId: z.string().min(1),
  serviceId: z.string().optional(),
  slotsToOffer: z.number().int().positive().default(DEFAULT_SLOTS_TO_OFFER),
  daysAhead: z.number().int().positive().default(DEFAULT_DAYS_AHEAD),
});

export type OfferBookingSlotsInput = z.infer<typeof offerBookingSlotsSchema>;

/**
 * Result of offering booking slots
 */
export interface OfferBookingSlotsResult {
  message: string;
  slots: Array<{
    date: string;
    startTime: string;
    endTime: string;
    displayTime: string;
    isoStart: string;
    isoEnd: string;
    practitionerName?: string;
    // Practitioner whose diary the slot belongs to. Required downstream so the
    // booking reduces THAT practitioner's availability rather than landing
    // with practitioner_id NULL, which nothing can subtract.
    practitionerId?: string;
  }>;
  noAvailability: boolean;
}

/**
 * Schema for parsing slot selection from user message
 */
export const parseSlotSelectionSchema = z.object({
  userMessage: z.string().min(1),
  offeredSlots: z.array(
    z.object({
      date: z.string(),
      startTime: z.string(),
      endTime: z.string(),
      displayTime: z.string(),
      isoStart: z.string(),
      isoEnd: z.string(),
      practitionerName: z.string().optional(),
      practitionerId: z.string().optional(),
    })
  ),
});

export type ParseSlotSelectionInput = z.infer<typeof parseSlotSelectionSchema>;

/**
 * Result of parsing slot selection
 */
export interface ParseSlotSelectionResult {
  matched: boolean;
  selectedSlot?: {
    date: string;
    startTime: string;
    endTime: string;
    displayTime: string;
    isoStart: string;
    isoEnd: string;
    practitionerName?: string;
    practitionerId?: string;
  };
  confidence: 'high' | 'medium' | 'low' | 'none';
  needsNegotiation?: boolean;
  requestedAlternative?: string;
}

/**
 * Schema for booking directly on lead's behalf
 */
export const bookDirectAppointmentSchema = z.object({
  conversationId: z.string().min(1),
  organizationId: z.string().min(1),
  slotIsoStart: z.string().min(1),
  slotIsoEnd: z.string().min(1),
  serviceId: z.string().optional(),
  practitionerId: z.string().optional(),
  customerName: z.string().min(1),
  customerPhone: z.string().optional(),
  customerEmail: z.string().email().optional(),
});

export type BookDirectAppointmentInput = z.infer<
  typeof bookDirectAppointmentSchema
>;

/**
 * Result of direct booking
 */
export interface BookDirectAppointmentResult {
  success: boolean;
  appointmentId: string;
  confirmationCode: string;
  confirmationMessage: string;
  slotTaken?: boolean;
}
