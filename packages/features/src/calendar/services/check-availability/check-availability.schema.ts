import { findOpenSlotsRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the canonical wire contract (`findOpenSlotsRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected
 * `organizationId` onto it. The endpoint this serves is
 * `POST /appointments/open-slots`, so the contract lives in
 * `requests/appointments.ts` even though the service lives in `calendar`.
 * Field rules (the `YYYY-MM-DD` regex, the 15–480 minute bounds, the
 * `timePreference` / `timezone` defaults) live in the contract; do not restate
 * them here.
 */
export const checkAvailabilitySchema = findOpenSlotsRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type CheckAvailabilityInput = z.infer<typeof checkAvailabilitySchema>;

/**
 * Available time slot returned by check availability
 */
export interface AvailableSlot {
  /**
   * Date in YYYY-MM-DD format
   */
  date: string;
  /**
   * Start time in HH:MM format (24-hour)
   */
  startTime: string;
  /**
   * End time in HH:MM format (24-hour)
   */
  endTime: string;
  /**
   * Human-readable time for voice (e.g., "2:30 PM")
   */
  displayTime: string;
  /**
   * ISO datetime string for the slot start
   */
  isoStart: string;
  /**
   * ISO datetime string for the slot end
   */
  isoEnd: string;
  /**
   * Practitioner whose availability produced this slot, when the slot came
   * from the shift-based path.
   *
   * Carrying this through matters for capacity: a booking made without a
   * practitioner cannot be subtracted from anyone's availability, so the same
   * time keeps being offered after it is taken, while an org-wide conflict
   * check simultaneously blocks every other practitioner for that slot.
   */
  practitionerId?: string;
  /**
   * Display name of the practitioner above.
   */
  practitionerName?: string;
}

export interface CheckAvailabilityResult {
  /**
   * Whether availability was successfully checked
   */
  available: boolean;
  /**
   * Available time slots
   */
  slots: AvailableSlot[];
  /**
   * Calendar provider that was queried
   */
  provider: string;
  /**
   * Message for voice agent to speak
   */
  message: string;
}
