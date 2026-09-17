/**
 * Wire types for the Meta Conversions API (`POST /{pixel_id}/events`).
 *
 * NAMING: Meta renamed "Pixels" to "Datasets" in the Events Manager UI. It is
 * the SAME object and the SAME API — `/act_{id}/adspixels` to manage it,
 * `/{pixel_id}/events` to send to it. There is no `datasets` endpoint to go
 * looking for.
 */

import type { HashedUserData, RawUserData } from './hash-user-data.js';

export interface MetaCapiCredentials {
  /** Business/system-user access token with `ads_management` on the pixel. */
  accessToken: string;
  /** The pixel (a.k.a. dataset) id these events belong to. */
  pixelId: string;
  /** Enables `appsecret_proof`; same secret that minted the token. */
  appSecret?: string;
  /**
   * Events Manager "Test events" code. Events sent with it are visible in the
   * test tool and excluded from attribution — staging only, never production.
   */
  testEventCode?: string;
}

/**
 * The standard events we send. `PageView` is browsing (consent-gated);
 * `Schedule` / `Lead` / `Purchase` are conversions with their own lawful basis.
 */
export type MetaCapiEventName =
  | 'PageView'
  | 'ViewContent'
  | 'Lead'
  | 'Contact'
  | 'Schedule'
  | 'InitiateCheckout'
  | 'Purchase'
  | 'CompleteRegistration';

export type MetaCapiActionSource =
  | 'website'
  | 'app'
  | 'phone_call'
  | 'chat'
  | 'email'
  | 'other'
  | 'system_generated'
  | 'business_messaging';

export interface MetaCapiCustomData {
  value?: number;
  currency?: string;
  content_name?: string;
  content_category?: string;
  content_ids?: string[];
  content_type?: string;
  /** Free-form; used for the microsite id so CAC survives a domain move. */
  [key: string]: unknown;
}

export interface MetaCapiEvent {
  event_name: MetaCapiEventName;
  /** Unix SECONDS. Meta rejects events older than 7 days. */
  event_time: number;
  /**
   * THE DEDUPLICATION KEY. Must be byte-identical to the browser event's
   * `eventID` for the same real-world action, or Meta counts the conversion
   * twice. See `event-id.ts` in `features/microsites/pixel` — that module owns
   * the contract; this field is only the wire slot it lands in.
   */
  event_id: string;
  event_source_url?: string;
  action_source: MetaCapiActionSource;
  user_data: HashedUserData;
  custom_data?: MetaCapiCustomData;
  /**
   * Limited Data Use (US/CCPA). `['LDU']` with country/state `0` lets Meta
   * geolocate and apply the correct restriction.
   */
  data_processing_options?: string[];
  data_processing_options_country?: number;
  data_processing_options_state?: number;
  opt_out?: boolean;
}

/** The un-hashed input a caller assembles; hashing happens in the client. */
export interface MetaCapiEventInput
  extends Omit<MetaCapiEvent, 'user_data' | 'action_source'> {
  action_source?: MetaCapiActionSource;
  user_data: RawUserData;
}

export interface MetaCapiSendResult {
  eventsReceived: number;
  fbtraceId?: string;
  /** Meta echoes back any field it could not use. Worth logging (no PII). */
  messages?: string[];
}
