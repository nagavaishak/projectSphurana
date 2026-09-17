/**
 * @borradh-workspace/api-client - Booking API Types
 *
 * Types for the public booking API endpoints.
 * Types are derived from backend packages.
 */

// Import backend input types from features
import type { SubmitGeneralBookingInput as BackendSubmitGeneralBookingInput } from '@borradh-workspace/features/booking-forms';

// Import backend response types for general booking
import type {
  GeneralBookingConfig as BackendGeneralBookingConfig,
  GeneralBookingResult as BackendGeneralBookingResult,
} from '@borradh-workspace/features/booking-forms';

import type { Serialize } from './serialization.js';

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * Time slot for availability
 */
export interface TimeSlot {
  startTime: string; // ISO string
  endTime: string; // ISO string
}

/**
 * Practitioner info with their available slots
 */
export interface PractitionerAvailability {
  practitioner: {
    id: string;
    name: string;
    photo: string | null;
    title: string | null;
  };
  slots: TimeSlot[];
}

/**
 * Available slots response
 */
export interface AvailableSlotsResponse {
  slots: TimeSlot[];
  byPractitioner?: PractitionerAvailability[];
}

// ============================================================================
// GENERAL BOOKING TYPES - For /book/{orgSlug} (no form required)
// ============================================================================

/**
 * General booking page configuration (org info + services list)
 */
export type GeneralBookingConfig = Serialize<BackendGeneralBookingConfig>;

/**
 * Result of submitting a general booking
 */
export type GeneralBookingResult = Serialize<BackendGeneralBookingResult>;

/**
 * Input for submitting a general booking (public)
 * Omits organizationSlug (from route param)
 */
export type SubmitGeneralBookingInput = Omit<
  BackendSubmitGeneralBookingInput,
  'organizationSlug'
>;
