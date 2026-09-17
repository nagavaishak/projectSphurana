/**
 * Common types for booking platform integrations
 */

export interface BookingOAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: number;
  scope?: string;
}

export interface BookingUserInfo {
  id: string;
  email?: string;
  name?: string;
  uri?: string; // Calendly user URI
  organizationUri?: string; // Calendly organization
  schedulingUrl?: string; // Calendly scheduling page URL
}

/**
 * Calendly-specific types
 */
export interface CalendlyUser {
  uri: string;
  name: string;
  email: string;
  slug: string;
  schedulingUrl: string;
  timezone: string;
  avatarUrl?: string;
  currentOrganization?: string;
}

export interface CalendlyEventType {
  uri: string;
  name: string;
  slug: string;
  active: boolean;
  duration: number;
  kind: 'solo' | 'group';
  schedulingUrl: string;
  description?: string;
  color?: string;
}

export interface CalendlyAvailableTime {
  startTime: string;
  status: 'available' | 'unavailable';
  inviteesRemaining?: number;
}

export interface CalendlyScheduledEvent {
  uri: string;
  name: string;
  status: 'active' | 'canceled';
  startTime: string;
  endTime: string;
  eventType: string;
  location?: {
    type: string;
    location?: string;
    joinUrl?: string;
  };
  invitees?: {
    uri: string;
    email: string;
    name?: string;
  }[];
}

export interface CalendlyCreateEventInviteeRequest {
  eventTypeUri: string;
  startTime: string;
  invitee: {
    email: string;
    name?: string;
    timezone?: string;
  };
  questions?: {
    questionUri: string;
    answer: string;
  }[];
}

/**
 * Timely-specific types
 */
export interface TimelyAccount {
  id: number;
  name: string;
  email: string;
  logoUrl?: string;
  timezone: string;
  currency: string;
}

export interface TimelyBooking {
  id: number;
  startTime: string;
  endTime: string;
  status: 'confirmed' | 'pending' | 'cancelled';
  clientName?: string;
  clientEmail?: string;
  serviceName?: string;
  staffName?: string;
  notes?: string;
}

export interface TimelyService {
  id: number;
  name: string;
  duration: number;
  price?: number;
  description?: string;
}

export interface TimelyStaff {
  id: number;
  name: string;
  email?: string;
  avatarUrl?: string;
}

/**
 * Phorest-specific types
 */
export interface PhorestClient {
  clientId: string;
  firstName: string;
  lastName: string;
  email?: string;
  mobile?: string;
  createdAt: string;
}

export interface PhorestBooking {
  id: string;
  startDateTime: string;
  endDateTime: string;
  status: string;
  clientId?: string;
  staffId?: string;
  services: {
    serviceId: string;
    name: string;
    duration: number;
    price?: number;
  }[];
  notes?: string;
}

export interface PhorestService {
  id: string;
  name: string;
  duration: number;
  price: number;
  category?: string;
}

export interface PhorestStaff {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
}

/**
 * Generic booking creation request
 */
export interface CreateBookingRequest {
  provider: 'calendly' | 'timely' | 'phorest' | 'fresha';
  startTime: string;
  endTime?: string;
  invitee: {
    email: string;
    name?: string;
    phone?: string;
  };
  eventTypeId?: string;
  serviceId?: string;
  staffId?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Generic booking result
 */
export interface BookingResult {
  id: string;
  provider: string;
  status: 'confirmed' | 'pending' | 'failed';
  startTime: string;
  endTime?: string;
  confirmationUrl?: string;
  cancelUrl?: string;
  rescheduleUrl?: string;
  error?: string;
}
