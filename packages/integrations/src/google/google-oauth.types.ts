/**
 * Google OAuth token response
 */
export interface GoogleOAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: number;
  scope: string;
}

/**
 * Stored credentials for Google services (Drive, Calendar, Gmail)
 * These are the decrypted credentials stored in the database
 */
export interface GoogleStoredCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * Google user info from OAuth
 */
export interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
  verifiedEmail: boolean;
}

/**
 * Google Calendar info
 */
export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  description?: string;
  timeZone: string;
  primary: boolean;
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
}

/**
 * Google Calendar event
 */
export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  status: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink: string;
  created: string;
  updated: string;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus: 'needsAction' | 'declined' | 'tentative' | 'accepted';
    organizer?: boolean;
    self?: boolean;
  }>;
}

/**
 * Create event input
 */
export interface CreateCalendarEventInput {
  /**
   * Optional client-supplied event id (Google allows this). Supply a value
   * derived deterministically from your own record id to make createEvent
   * idempotent: a retried create with the same id collides (HTTP 409) instead
   * of inserting a duplicate event. Must be 5–1024 chars of base32hex
   * ([a-v0-9]); a lowercase hex hash satisfies this.
   */
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime: string;
    timeZone?: string;
  };
  end: {
    dateTime: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
  }>;
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{
      method: 'email' | 'popup';
      minutes: number;
    }>;
  };
}

/**
 * Watch channel response from events.watch
 */
export interface WatchChannelResponse {
  resourceId: string;
  expiration: string;
}

/**
 * Incremental sync response using syncToken
 */
export interface SyncEventsResponse {
  events: GoogleCalendarEvent[];
  nextSyncToken: string;
  fullSyncRequired?: boolean;
}

/**
 * Free/busy response
 */
export interface FreeBusyResponse {
  timeMin: string;
  timeMax: string;
  calendars: {
    [calendarId: string]: {
      busy: Array<{
        start: string;
        end: string;
      }>;
      errors?: Array<{
        domain: string;
        reason: string;
      }>;
    };
  };
}
