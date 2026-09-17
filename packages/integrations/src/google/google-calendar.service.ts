import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import type {
  CreateCalendarEventInput,
  FreeBusyResponse,
  GoogleCalendarEvent,
  GoogleCalendarInfo,
  SyncEventsResponse,
  WatchChannelResponse,
} from './google-oauth.types.js';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

/**
 * Service for interacting with Google Calendar API
 * Supports two-way sync: read availability and create/manage events
 */
export class GoogleCalendarService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * List all calendars the user has access to
   */
  async listCalendars(): Promise<GoogleCalendarInfo[]> {
    const response = await fetchWithRetry(
      `${CALENDAR_API_BASE}/users/me/calendarList`,
      {
        timeoutMs: 15000,
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to list calendars: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      items?: Array<{
        id: string;
        summary: string;
        description?: string;
        timeZone: string;
        primary?: boolean;
        accessRole: string;
      }>;
    };

    return (data.items || []).map((cal) => ({
      id: cal.id,
      summary: cal.summary,
      description: cal.description,
      timeZone: cal.timeZone,
      primary: cal.primary ?? false,
      accessRole: cal.accessRole as GoogleCalendarInfo['accessRole'],
    }));
  }

  /**
   * Get the primary calendar
   */
  async getPrimaryCalendar(): Promise<GoogleCalendarInfo | null> {
    const calendars = await this.listCalendars();
    return calendars.find((cal) => cal.primary) || null;
  }

  /**
   * Get free/busy information for a calendar
   * Used to check availability before scheduling
   */
  async getFreeBusy(
    calendarId: string,
    timeMin: Date,
    timeMax: Date
  ): Promise<FreeBusyResponse> {
    const response = await fetchWithRetry(`${CALENDAR_API_BASE}/freeBusy`, {
      timeoutMs: 15000,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: calendarId }],
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to get free/busy: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      timeMin: string;
      timeMax: string;
      calendars: Record<
        string,
        {
          busy: Array<{ start: string; end: string }>;
          errors?: Array<{ domain: string; reason: string }>;
        }
      >;
    };

    return {
      timeMin: data.timeMin,
      timeMax: data.timeMax,
      calendars: data.calendars,
    };
  }

  /**
   * List events from a calendar within a time range
   */
  async listEvents(
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
    maxResults = 250
  ): Promise<GoogleCalendarEvent[]> {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: String(maxResults),
      singleEvents: 'true',
      orderBy: 'startTime',
    });

    const response = await fetchWithRetry(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      {
        timeoutMs: 15000,
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to list events: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      items?: Array<{
        id: string;
        summary: string;
        description?: string;
        location?: string;
        start: { dateTime?: string; date?: string; timeZone?: string };
        end: { dateTime?: string; date?: string; timeZone?: string };
        status: string;
        htmlLink: string;
        created: string;
        updated: string;
        attendees?: Array<{
          email: string;
          displayName?: string;
          responseStatus: string;
          organizer?: boolean;
          self?: boolean;
        }>;
      }>;
    };

    return (data.items || []).map((event) => ({
      id: event.id,
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: event.start,
      end: event.end,
      status: event.status as GoogleCalendarEvent['status'],
      htmlLink: event.htmlLink,
      created: event.created,
      updated: event.updated,
      attendees: event.attendees?.map((a) => ({
        email: a.email,
        displayName: a.displayName,
        responseStatus: a.responseStatus as
          | 'needsAction'
          | 'declined'
          | 'tentative'
          | 'accepted',
        organizer: a.organizer,
        self: a.self,
      })),
    }));
  }

  /**
   * Create a new calendar event
   */
  async createEvent(
    calendarId: string,
    event: CreateCalendarEventInput
  ): Promise<GoogleCalendarEvent> {
    const response = await fetchWithTimeout(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        timeoutMs: 15000,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Client-supplied id (optional) makes creation idempotent — a retry
          // with the same id returns 409 instead of duplicating the event.
          id: event.id,
          summary: event.summary,
          description: event.description,
          location: event.location,
          start: event.start,
          end: event.end,
          attendees: event.attendees?.map((a) => ({
            email: a.email,
            displayName: a.displayName,
          })),
          reminders: event.reminders,
        }),
      }
    );

    if (!response.ok) {
      // 409 = an event with this (client-supplied) id already exists. That means
      // a previous create succeeded but we never recorded it (e.g. the DB write
      // failed and the job retried). Treat it as idempotent success: return the
      // existing event rather than erroring or creating a duplicate.
      if (response.status === 409 && event.id) {
        return this.getEvent(calendarId, event.id);
      }
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to create event: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      id: string;
      summary: string;
      description?: string;
      location?: string;
      start: { dateTime?: string; date?: string; timeZone?: string };
      end: { dateTime?: string; date?: string; timeZone?: string };
      status: string;
      htmlLink: string;
      created: string;
      updated: string;
    };

    return {
      id: data.id,
      summary: data.summary,
      description: data.description,
      location: data.location,
      start: data.start,
      end: data.end,
      status: data.status as GoogleCalendarEvent['status'],
      htmlLink: data.htmlLink,
      created: data.created,
      updated: data.updated,
    };
  }

  /**
   * Update an existing calendar event
   */
  async updateEvent(
    calendarId: string,
    eventId: string,
    updates: Partial<CreateCalendarEventInput>
  ): Promise<GoogleCalendarEvent> {
    const response = await fetchWithTimeout(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        timeoutMs: 15000,
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to update event: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      id: string;
      summary: string;
      description?: string;
      location?: string;
      start: { dateTime?: string; date?: string; timeZone?: string };
      end: { dateTime?: string; date?: string; timeZone?: string };
      status: string;
      htmlLink: string;
      created: string;
      updated: string;
    };

    return {
      id: data.id,
      summary: data.summary,
      description: data.description,
      location: data.location,
      start: data.start,
      end: data.end,
      status: data.status as GoogleCalendarEvent['status'],
      htmlLink: data.htmlLink,
      created: data.created,
      updated: data.updated,
    };
  }

  /**
   * Delete a calendar event
   */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const response = await fetchWithTimeout(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        timeoutMs: 15000,
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok && response.status !== 410) {
      // 410 Gone is acceptable (already deleted)
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to delete event: ${error.error?.message || 'Unknown error'}`
      );
    }
  }

  /**
   * Get a single event by ID
   */
  async getEvent(
    calendarId: string,
    eventId: string
  ): Promise<GoogleCalendarEvent> {
    const response = await fetchWithRetry(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        timeoutMs: 15000,
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to get event: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      id: string;
      summary: string;
      description?: string;
      location?: string;
      start: { dateTime?: string; date?: string; timeZone?: string };
      end: { dateTime?: string; date?: string; timeZone?: string };
      status: string;
      htmlLink: string;
      created: string;
      updated: string;
      attendees?: Array<{
        email: string;
        displayName?: string;
        responseStatus: string;
        organizer?: boolean;
        self?: boolean;
      }>;
    };

    return {
      id: data.id,
      summary: data.summary,
      description: data.description,
      location: data.location,
      start: data.start,
      end: data.end,
      status: data.status as GoogleCalendarEvent['status'],
      htmlLink: data.htmlLink,
      created: data.created,
      updated: data.updated,
      attendees: data.attendees?.map((a) => ({
        email: a.email,
        displayName: a.displayName,
        responseStatus: a.responseStatus as
          | 'needsAction'
          | 'declined'
          | 'tentative'
          | 'accepted',
        organizer: a.organizer,
        self: a.self,
      })),
    };
  }

  /**
   * Create a new secondary calendar
   */
  async createCalendar(
    summary: string
  ): Promise<{ id: string; summary: string }> {
    const response = await fetchWithTimeout(`${CALENDAR_API_BASE}/calendars`, {
      timeoutMs: 15000,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ summary }),
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: { message?: string } };
      throw new Error(
        `Failed to create calendar: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as { id: string; summary: string };
    return { id: data.id, summary: data.summary };
  }

  /**
   * Delete a calendar
   */
  async deleteCalendar(calendarId: string): Promise<void> {
    const response = await fetchWithTimeout(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}`,
      {
        timeoutMs: 15000,
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok && response.status !== 404) {
      const error = (await response.json()) as { error?: { message?: string } };
      throw new Error(
        `Failed to delete calendar: ${error.error?.message || 'Unknown error'}`
      );
    }
  }

  /**
   * Set up a push notification watch channel for calendar events
   */
  async watchEvents(
    calendarId: string,
    channelId: string,
    webhookUrl: string,
    token?: string
  ): Promise<WatchChannelResponse> {
    const body: Record<string, unknown> = {
      id: channelId,
      type: 'web_hook',
      address: webhookUrl,
      params: { ttl: '604800' }, // 7 days
    };
    if (token) {
      body.token = token;
    }

    const response = await fetchWithTimeout(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/watch`,
      {
        timeoutMs: 15000,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as { error?: { message?: string } };
      throw new Error(
        `Failed to watch events: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      resourceId: string;
      expiration: string;
    };

    return {
      resourceId: data.resourceId,
      expiration: data.expiration,
    };
  }

  /**
   * Stop a push notification watch channel
   */
  async stopWatch(channelId: string, resourceId: string): Promise<void> {
    const response = await fetchWithTimeout(
      'https://www.googleapis.com/calendar/v3/channels/stop',
      {
        timeoutMs: 15000,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: channelId, resourceId }),
      }
    );

    // 404 is acceptable — channel may already be expired/stopped
    if (!response.ok && response.status !== 404) {
      const error = (await response.json()) as { error?: { message?: string } };
      throw new Error(
        `Failed to stop watch: ${error.error?.message || 'Unknown error'}`
      );
    }
  }

  /**
   * List events using a sync token for incremental sync.
   * If no syncToken is provided, does a full initial sync.
   * On 410 GONE (expired token), returns fullSyncRequired flag.
   */
  async listEventsWithSyncToken(
    calendarId: string,
    syncToken?: string
  ): Promise<SyncEventsResponse> {
    const params = new URLSearchParams();

    if (syncToken) {
      params.set('syncToken', syncToken);
    } else {
      // Initial sync — get all events from now onwards
      params.set('timeMin', new Date().toISOString());
      params.set('singleEvents', 'true');
    }
    params.set('maxResults', '250');

    const response = await fetchWithRetry(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      {
        timeoutMs: 15000,
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (response.status === 410) {
      // Sync token expired — caller must do full re-sync
      return { events: [], nextSyncToken: '', fullSyncRequired: true };
    }

    if (!response.ok) {
      const error = (await response.json()) as { error?: { message?: string } };
      throw new Error(
        `Failed to sync events: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        description?: string;
        location?: string;
        start?: { dateTime?: string; date?: string; timeZone?: string };
        end?: { dateTime?: string; date?: string; timeZone?: string };
        status: string;
        htmlLink?: string;
        created?: string;
        updated?: string;
      }>;
      nextSyncToken?: string;
      nextPageToken?: string;
    };

    // Handle pagination — collect all pages
    let allItems = data.items || [];
    let pageToken = data.nextPageToken;
    let finalSyncToken = data.nextSyncToken || '';

    while (pageToken) {
      const pageParams = new URLSearchParams(params);
      pageParams.set('pageToken', pageToken);

      const pageResponse = await fetchWithRetry(
        `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${pageParams}`,
        {
          timeoutMs: 15000,
          headers: { Authorization: `Bearer ${this.accessToken}` },
        }
      );

      if (!pageResponse.ok) break;

      const pageData = (await pageResponse.json()) as {
        items?: typeof allItems;
        nextSyncToken?: string;
        nextPageToken?: string;
      };

      allItems = allItems.concat(pageData.items || []);
      pageToken = pageData.nextPageToken;
      if (pageData.nextSyncToken) {
        finalSyncToken = pageData.nextSyncToken;
      }
    }

    const events: GoogleCalendarEvent[] = allItems.map((event) => ({
      id: event.id,
      summary: event.summary || '',
      description: event.description,
      location: event.location,
      start: event.start || {},
      end: event.end || {},
      status: event.status as GoogleCalendarEvent['status'],
      htmlLink: event.htmlLink || '',
      created: event.created || '',
      updated: event.updated || '',
    }));

    return { events, nextSyncToken: finalSyncToken };
  }
}
