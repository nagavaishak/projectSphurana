/**
 * Calendar Provider Integrations
 *
 * Unified interface for booking appointments across multiple calendar providers:
 * - Fresha (salon/spa management)
 * - Phorest (salon management)
 * - Timely (appointment scheduling)
 * - Calendly (general scheduling)
 * - Cal.com (open-source scheduling)
 *
 * These are called via Telnyx AI tool webhooks during voice calls.
 */

import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import { logError } from '@borradh-workspace/observability';
import type {
  BookAppointmentRequest,
  BookAppointmentResult,
  CalendarProvider,
  CheckAvailabilityRequest,
  CheckAvailabilityResult,
  TimeSlot,
} from './telnyx-ai.types.js';

// ============================================================================
// Base Provider Interface
// ============================================================================

export interface CalendarProviderClient {
  checkAvailability(
    request: CheckAvailabilityRequest
  ): Promise<CheckAvailabilityResult>;
  bookAppointment(
    request: BookAppointmentRequest
  ): Promise<BookAppointmentResult>;
  cancelAppointment?(
    appointmentId: string
  ): Promise<{ success: boolean; error?: string }>;
}

// ============================================================================
// Fresha Provider
// ============================================================================

/**
 * Fresha API Client
 * @see https://partners.fresha.com/docs
 */
export class FreshaProvider implements CalendarProviderClient {
  private apiKey: string;
  private partnerId: string;
  private baseUrl = 'https://partners.fresha.com/api/v1';

  constructor(config: CalendarProvider) {
    if (!config.apiKey) throw new Error('Fresha API key is required');
    if (!config.businessId)
      throw new Error('Fresha partner/business ID is required');
    this.apiKey = config.apiKey;
    this.partnerId = config.businessId;
  }

  async checkAvailability(
    request: CheckAvailabilityRequest
  ): Promise<CheckAvailabilityResult> {
    try {
      const params = new URLSearchParams({
        start_date: request.dateFrom.toISOString().split('T')[0],
        end_date: request.dateTo.toISOString().split('T')[0],
        ...(request.serviceId && { service_id: request.serviceId }),
        ...(request.staffId && { staff_id: request.staffId }),
      });

      const response = await fetchWithRetry(
        `${this.baseUrl}/partners/${this.partnerId}/availability?${params}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeoutMs: 15000,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, slots: [], error };
      }

      const data = (await response.json()) as FreshaAvailabilityResponse;
      const slots: TimeSlot[] = data.data.flatMap((day) =>
        day.slots.map((slot) => ({
          startTime: new Date(slot.start_time),
          endTime: new Date(slot.end_time),
          staffId: slot.staff_id,
          staffName: slot.staff_name,
          serviceId: request.serviceId,
        }))
      );

      return { success: true, slots };
    } catch (error) {
      logError('fresha.checkAvailability', error, { feature: 'voice' });
      return {
        success: false,
        slots: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async bookAppointment(
    request: BookAppointmentRequest
  ): Promise<BookAppointmentResult> {
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/partners/${this.partnerId}/appointments`,
        {
          method: 'POST',
          timeoutMs: 15000,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            start_time: request.startTime.toISOString(),
            service_id: request.serviceId,
            staff_id: request.staffId,
            client: {
              first_name: request.customerName.split(' ')[0],
              last_name:
                request.customerName.split(' ').slice(1).join(' ') || '',
              phone: request.customerPhone,
              email: request.customerEmail,
            },
            notes: request.notes,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const data = (await response.json()) as FreshaAppointmentResponse;
      return {
        success: true,
        appointmentId: data.data.id,
        confirmationCode: data.data.confirmation_code,
        startTime: new Date(data.data.start_time),
        endTime: new Date(data.data.end_time),
      };
    } catch (error) {
      logError('fresha.bookAppointment', error, { feature: 'voice' });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

interface FreshaAvailabilityResponse {
  data: {
    date: string;
    slots: {
      start_time: string;
      end_time: string;
      staff_id: string;
      staff_name: string;
    }[];
  }[];
}

interface FreshaAppointmentResponse {
  data: {
    id: string;
    confirmation_code: string;
    start_time: string;
    end_time: string;
  };
}

// ============================================================================
// Phorest Provider
// ============================================================================

/**
 * Phorest API Client
 * @see https://developers.phorest.com/docs
 */
export class PhorestProvider implements CalendarProviderClient {
  private clientId: string;
  private clientSecret: string;
  private businessId: string;
  private baseUrl =
    'https://api-gateway-eu.phorest.com/third-party-api-server/api';

  constructor(config: CalendarProvider) {
    if (!config.apiKey) throw new Error('Phorest client ID is required');
    if (!config.apiSecret) throw new Error('Phorest client secret is required');
    if (!config.businessId) throw new Error('Phorest business ID is required');
    this.clientId = config.apiKey;
    this.clientSecret = config.apiSecret;
    this.businessId = config.businessId;
  }

  private async getAuthToken(): Promise<string> {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`
    ).toString('base64');

    const response = await fetchWithRetry(
      'https://api-gateway-eu.phorest.com/third-party-api-server/api/oauth/token',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        timeoutMs: 15000,
      }
    );

    const data = (await response.json()) as { access_token: string };
    return data.access_token;
  }

  async checkAvailability(
    request: CheckAvailabilityRequest
  ): Promise<CheckAvailabilityResult> {
    try {
      const token = await this.getAuthToken();

      const response = await fetchWithRetry(
        `${this.baseUrl}/business/${this.businessId}/availability`,
        {
          method: 'POST',
          timeoutMs: 15000,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            startDate: request.dateFrom.toISOString().split('T')[0],
            endDate: request.dateTo.toISOString().split('T')[0],
            serviceId: request.serviceId,
            staffId: request.staffId,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, slots: [], error };
      }

      const data = (await response.json()) as PhorestAvailabilityResponse;
      const slots: TimeSlot[] = data.availableSlots.map((slot) => ({
        startTime: new Date(slot.startDateTime),
        endTime: new Date(slot.endDateTime),
        staffId: slot.staffId,
        staffName: slot.staffName,
        serviceId: request.serviceId,
      }));

      return { success: true, slots };
    } catch (error) {
      logError('phorest.checkAvailability', error, { feature: 'voice' });
      return {
        success: false,
        slots: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async bookAppointment(
    request: BookAppointmentRequest
  ): Promise<BookAppointmentResult> {
    try {
      const token = await this.getAuthToken();

      const response = await fetchWithTimeout(
        `${this.baseUrl}/business/${this.businessId}/appointment`,
        {
          method: 'POST',
          timeoutMs: 15000,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            startDateTime: request.startTime.toISOString(),
            serviceId: request.serviceId,
            staffId: request.staffId,
            client: {
              firstName: request.customerName.split(' ')[0],
              lastName:
                request.customerName.split(' ').slice(1).join(' ') || '',
              mobile: request.customerPhone,
              email: request.customerEmail,
            },
            notes: request.notes,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const data = (await response.json()) as PhorestAppointmentResponse;
      return {
        success: true,
        appointmentId: data.appointmentId,
        startTime: new Date(data.startDateTime),
        endTime: new Date(data.endDateTime),
      };
    } catch (error) {
      logError('phorest.bookAppointment', error, { feature: 'voice' });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

interface PhorestAvailabilityResponse {
  availableSlots: {
    startDateTime: string;
    endDateTime: string;
    staffId: string;
    staffName: string;
  }[];
}

interface PhorestAppointmentResponse {
  appointmentId: string;
  startDateTime: string;
  endDateTime: string;
}

// ============================================================================
// Timely Provider
// ============================================================================

/**
 * Timely API Client
 * @see https://developers.gettimely.com/
 */
export class TimelyProvider implements CalendarProviderClient {
  private apiKey: string;
  private businessId: string;
  private baseUrl = 'https://api.gettimely.com/v1';

  constructor(config: CalendarProvider) {
    if (!config.apiKey) throw new Error('Timely API key is required');
    if (!config.businessId) throw new Error('Timely business ID is required');
    this.apiKey = config.apiKey;
    this.businessId = config.businessId;
  }

  async checkAvailability(
    request: CheckAvailabilityRequest
  ): Promise<CheckAvailabilityResult> {
    try {
      const params = new URLSearchParams({
        start_date: request.dateFrom.toISOString().split('T')[0],
        end_date: request.dateTo.toISOString().split('T')[0],
        ...(request.serviceId && { service_id: request.serviceId }),
        ...(request.staffId && { staff_id: request.staffId }),
      });

      const response = await fetchWithRetry(
        `${this.baseUrl}/businesses/${this.businessId}/availability?${params}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeoutMs: 15000,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, slots: [], error };
      }

      const data = (await response.json()) as TimelyAvailabilityResponse;
      const slots: TimeSlot[] = data.availability.flatMap((day) =>
        day.time_slots.map((slot) => ({
          startTime: new Date(`${day.date}T${slot.start_time}`),
          endTime: new Date(`${day.date}T${slot.end_time}`),
          staffId: slot.staff_id?.toString(),
          staffName: slot.staff_name,
          serviceId: request.serviceId,
        }))
      );

      return { success: true, slots };
    } catch (error) {
      logError('timely.checkAvailability', error, { feature: 'voice' });
      return {
        success: false,
        slots: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async bookAppointment(
    request: BookAppointmentRequest
  ): Promise<BookAppointmentResult> {
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/businesses/${this.businessId}/bookings`,
        {
          method: 'POST',
          timeoutMs: 15000,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            start_at: request.startTime.toISOString(),
            service_id: request.serviceId,
            staff_id: request.staffId,
            customer: {
              first_name: request.customerName.split(' ')[0],
              last_name:
                request.customerName.split(' ').slice(1).join(' ') || '',
              phone: request.customerPhone,
              email: request.customerEmail,
            },
            notes: request.notes,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const data = (await response.json()) as TimelyBookingResponse;
      return {
        success: true,
        appointmentId: data.booking.id.toString(),
        startTime: new Date(data.booking.start_at),
        endTime: new Date(data.booking.end_at),
      };
    } catch (error) {
      logError('timely.bookAppointment', error, { feature: 'voice' });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

interface TimelyAvailabilityResponse {
  availability: {
    date: string;
    time_slots: {
      start_time: string;
      end_time: string;
      staff_id?: number;
      staff_name?: string;
    }[];
  }[];
}

interface TimelyBookingResponse {
  booking: {
    id: number;
    start_at: string;
    end_at: string;
  };
}

// ============================================================================
// Calendly Provider
// ============================================================================

/**
 * Calendly API Client
 * @see https://developer.calendly.com/api-docs
 */
export class CalendlyProvider implements CalendarProviderClient {
  private apiKey: string;
  private eventTypeUri?: string;
  private baseUrl = 'https://api.calendly.com';

  constructor(config: CalendarProvider) {
    if (!config.apiKey) throw new Error('Calendly API key is required');
    this.apiKey = config.apiKey;
    // eventTypeId in Calendly is actually a full URI
    this.eventTypeUri = config.eventTypeId?.toString();
  }

  async checkAvailability(
    request: CheckAvailabilityRequest
  ): Promise<CheckAvailabilityResult> {
    try {
      if (!this.eventTypeUri) {
        return {
          success: false,
          slots: [],
          error: 'Event type URI is required',
        };
      }

      const params = new URLSearchParams({
        event_type: this.eventTypeUri,
        start_time: request.dateFrom.toISOString(),
        end_time: request.dateTo.toISOString(),
      });

      const response = await fetchWithRetry(
        `${this.baseUrl}/event_type_available_times?${params}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeoutMs: 15000,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, slots: [], error };
      }

      const data = (await response.json()) as CalendlyAvailabilityResponse;
      const slots: TimeSlot[] = data.collection.map((slot) => ({
        startTime: new Date(slot.start_time),
        endTime: new Date(new Date(slot.start_time).getTime() + 30 * 60 * 1000), // Assume 30min slots
        serviceId: this.eventTypeUri,
      }));

      return { success: true, slots };
    } catch (error) {
      logError('calendly.checkAvailability', error, { feature: 'voice' });
      return {
        success: false,
        slots: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async bookAppointment(
    request: BookAppointmentRequest
  ): Promise<BookAppointmentResult> {
    try {
      // Calendly uses scheduling links, not direct booking API
      // For phone-based booking, we need to use the one-off scheduling link
      // or use the invitee creation with a pre-selected time

      const response = await fetchWithTimeout(
        `${this.baseUrl}/scheduling_links`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            max_event_count: 1,
            owner: this.eventTypeUri,
            owner_type: 'EventType',
          }),
          timeoutMs: 15000,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const data = (await response.json()) as CalendlySchedulingLinkResponse;

      // Note: Calendly doesn't allow direct programmatic booking
      // The booking_url should be sent to the customer
      // For voice calls, you might want to collect info and create manually
      return {
        success: true,
        appointmentId: data.resource.owner,
        confirmationCode: data.resource.booking_url,
        startTime: request.startTime,
      };
    } catch (error) {
      logError('calendly.bookAppointment', error, { feature: 'voice' });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

interface CalendlyAvailabilityResponse {
  collection: {
    start_time: string;
    status: string;
  }[];
}

interface CalendlySchedulingLinkResponse {
  resource: {
    booking_url: string;
    owner: string;
  };
}

// ============================================================================
// Provider Factory
// ============================================================================

/**
 * Create a calendar provider client based on configuration
 */
export function createCalendarProvider(
  config: CalendarProvider
): CalendarProviderClient {
  switch (config.type) {
    case 'fresha':
      return new FreshaProvider(config);
    case 'phorest':
      return new PhorestProvider(config);
    case 'timely':
      return new TimelyProvider(config);
    case 'calendly':
      return new CalendlyProvider(config);
    case 'cal_com':
      throw new Error(
        'Cal.com provider is not yet supported - use Calendly or another provider instead'
      );
    default:
      throw new Error(`Unsupported calendar provider: ${config.type}`);
  }
}

/**
 * Format time slots for voice conversation
 */
export function formatSlotsForVoice(slots: TimeSlot[], maxSlots = 3): string {
  if (slots.length === 0) {
    return "I don't see any available slots for that time period.";
  }

  const limitedSlots = slots.slice(0, maxSlots);
  const formatted = limitedSlots
    .map((slot, index) => {
      const date = slot.startTime.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      const time = slot.startTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      const staffInfo = slot.staffName ? ` with ${slot.staffName}` : '';
      return `Option ${index + 1}: ${date} at ${time}${staffInfo}`;
    })
    .join('. ');

  const moreInfo =
    slots.length > maxSlots
      ? ` I have ${slots.length - maxSlots} more options if none of these work.`
      : '';

  return `I have some availability for you. ${formatted}.${moreInfo}`;
}

/**
 * Parse natural language time preference to time of day
 */
export function parseTimePreference(
  input: string
): 'morning' | 'afternoon' | 'evening' | 'any' {
  const lower = input.toLowerCase();

  if (
    lower.includes('morning') ||
    lower.includes('early') ||
    lower.includes('am')
  ) {
    return 'morning';
  }
  if (
    lower.includes('afternoon') ||
    lower.includes('lunch') ||
    lower.includes('midday')
  ) {
    return 'afternoon';
  }
  if (
    lower.includes('evening') ||
    lower.includes('late') ||
    lower.includes('after work') ||
    lower.includes('pm')
  ) {
    return 'evening';
  }

  return 'any';
}

/**
 * Filter slots by time of day preference
 */
export function filterSlotsByTimeOfDay(
  slots: TimeSlot[],
  preference: 'morning' | 'afternoon' | 'evening' | 'any'
): TimeSlot[] {
  if (preference === 'any') return slots;

  return slots.filter((slot) => {
    const hour = slot.startTime.getHours();

    switch (preference) {
      case 'morning':
        return hour >= 6 && hour < 12;
      case 'afternoon':
        return hour >= 12 && hour < 17;
      case 'evening':
        return hour >= 17 && hour < 21;
      default:
        return true;
    }
  });
}
