import { fetchWithTimeout } from '@borradh-workspace/http';
import type {
  CalendlyAvailableTime,
  CalendlyCreateEventInviteeRequest,
  CalendlyEventType,
  CalendlyScheduledEvent,
} from './booking.types.js';

const CALENDLY_API_BASE = 'https://api.calendly.com';

/**
 * Service for Calendly API operations (booking, availability, events)
 *
 * This service is used after OAuth authentication is complete.
 * Use CalendlyOAuthService for the OAuth flow.
 *
 * @see https://developer.calendly.com/api-docs
 */
export class CalendlyApiService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Make an authenticated API request
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    params?: Record<string, string>
  ): Promise<T> {
    let url = `${CALENDLY_API_BASE}${endpoint}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url = `${url}?${searchParams.toString()}`;
    }

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    const response = await fetchWithTimeout(url, {
      ...options,
      timeoutMs: 15000,
    });

    if (!response.ok) {
      const error = (await response.json()) as {
        title?: string;
        message?: string;
        details?: unknown;
      };
      throw new Error(
        `Calendly API error (${response.status}): ${error.message || error.title || 'Unknown error'}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get organization members (team members) from Calendly
   * @see https://developer.calendly.com/api-docs/01011b1cab0ae-list-organization-memberships
   */
  async getOrganizationMembers(organizationUri: string): Promise<
    Array<{
      uri: string;
      email: string;
      name: string;
      role: string;
      userUri: string;
      schedulingUrl: string;
      avatarUrl?: string;
    }>
  > {
    const data = await this.request<{
      collection: Array<{
        uri: string;
        role: string;
        user: {
          uri: string;
          name: string;
          email: string;
          scheduling_url: string;
          avatar_url?: string;
        };
      }>;
    }>('GET', '/organization_memberships', undefined, {
      organization: organizationUri,
    });

    return data.collection.map((m) => ({
      uri: m.uri,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      userUri: m.user.uri,
      schedulingUrl: m.user.scheduling_url,
      avatarUrl: m.user.avatar_url,
    }));
  }

  /**
   * Get event types for a user
   */
  async getEventTypes(userUri: string): Promise<CalendlyEventType[]> {
    const data = await this.request<{
      collection: Array<{
        uri: string;
        name: string;
        slug: string;
        active: boolean;
        duration: number;
        kind: 'solo' | 'group';
        scheduling_url: string;
        description_plain?: string;
        color?: string;
      }>;
    }>('GET', '/event_types', undefined, { user: userUri, active: 'true' });

    return data.collection.map((et) => ({
      uri: et.uri,
      name: et.name,
      slug: et.slug,
      active: et.active,
      duration: et.duration,
      kind: et.kind,
      schedulingUrl: et.scheduling_url,
      description: et.description_plain,
      color: et.color,
    }));
  }

  /**
   * Get available times for an event type
   * Note: Limited to 7 days per request
   */
  async getAvailableTimes(
    eventTypeUri: string,
    startTime: string,
    endTime: string
  ): Promise<CalendlyAvailableTime[]> {
    const data = await this.request<{
      collection: Array<{
        start_time: string;
        status: 'available' | 'unavailable';
        invitees_remaining?: number;
      }>;
    }>('GET', '/event_type_available_times', undefined, {
      event_type: eventTypeUri,
      start_time: startTime,
      end_time: endTime,
    });

    return data.collection.map((slot) => ({
      startTime: slot.start_time,
      status: slot.status,
      inviteesRemaining: slot.invitees_remaining,
    }));
  }

  /**
   * Create a scheduled event (book an appointment)
   * Uses the Scheduling API to book on behalf of invitees
   *
   * @see https://developer.calendly.com/schedule-events-with-ai-agents
   */
  async createScheduledEvent(
    request: CalendlyCreateEventInviteeRequest
  ): Promise<CalendlyScheduledEvent> {
    const data = await this.request<{
      resource: {
        uri: string;
        name: string;
        status: 'active' | 'canceled';
        start_time: string;
        end_time: string;
        event_type: string;
        location?: {
          type: string;
          location?: string;
          join_url?: string;
        };
        invitees: Array<{
          uri: string;
          email: string;
          name?: string;
        }>;
      };
    }>('POST', '/scheduled_events', {
      event_type_uuid: this.extractUuid(request.eventTypeUri),
      start_time: request.startTime,
      invitee: {
        email: request.invitee.email,
        name: request.invitee.name,
        timezone: request.invitee.timezone,
      },
      ...(request.questions && {
        questions_and_answers: request.questions.map((q) => ({
          question_uuid: this.extractUuid(q.questionUri),
          answer: q.answer,
        })),
      }),
    });

    return {
      uri: data.resource.uri,
      name: data.resource.name,
      status: data.resource.status,
      startTime: data.resource.start_time,
      endTime: data.resource.end_time,
      eventType: data.resource.event_type,
      location: data.resource.location
        ? {
            type: data.resource.location.type,
            location: data.resource.location.location,
            joinUrl: data.resource.location.join_url,
          }
        : undefined,
      invitees: data.resource.invitees,
    };
  }

  /**
   * Get scheduled events for a user
   */
  async getScheduledEvents(
    userUri: string,
    params?: {
      minStartTime?: string;
      maxStartTime?: string;
      status?: 'active' | 'canceled';
      count?: number;
    }
  ): Promise<CalendlyScheduledEvent[]> {
    const queryParams: Record<string, string> = { user: userUri };
    if (params?.minStartTime) queryParams.min_start_time = params.minStartTime;
    if (params?.maxStartTime) queryParams.max_start_time = params.maxStartTime;
    if (params?.status) queryParams.status = params.status;
    if (params?.count) queryParams.count = params.count.toString();

    const data = await this.request<{
      collection: Array<{
        uri: string;
        name: string;
        status: 'active' | 'canceled';
        start_time: string;
        end_time: string;
        event_type: string;
        location?: {
          type: string;
          location?: string;
          join_url?: string;
        };
      }>;
    }>('GET', '/scheduled_events', undefined, queryParams);

    return data.collection.map((event) => ({
      uri: event.uri,
      name: event.name,
      status: event.status,
      startTime: event.start_time,
      endTime: event.end_time,
      eventType: event.event_type,
      location: event.location
        ? {
            type: event.location.type,
            location: event.location.location,
            joinUrl: event.location.join_url,
          }
        : undefined,
    }));
  }

  /**
   * Cancel a scheduled event
   */
  async cancelEvent(eventUri: string, reason?: string): Promise<void> {
    const eventUuid = this.extractUuid(eventUri);
    await this.request<void>(
      'POST',
      `/scheduled_events/${eventUuid}/cancellation`,
      {
        reason,
      }
    );
  }

  /**
   * Get invitees for a scheduled event
   */
  async getEventInvitees(
    eventUri: string
  ): Promise<
    Array<{ uri: string; email: string; name?: string; status: string }>
  > {
    const eventUuid = this.extractUuid(eventUri);
    const data = await this.request<{
      collection: Array<{
        uri: string;
        email: string;
        name?: string;
        status: string;
      }>;
    }>('GET', `/scheduled_events/${eventUuid}/invitees`);

    return data.collection;
  }

  /**
   * Extract UUID from a Calendly URI
   * e.g., "https://api.calendly.com/event_types/abc123" -> "abc123"
   */
  private extractUuid(uri: string): string {
    const parts = uri.split('/');
    return parts[parts.length - 1];
  }
}
