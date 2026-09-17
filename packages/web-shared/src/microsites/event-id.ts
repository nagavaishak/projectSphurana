/**
 * THE `event_id` contract between the browser pixel and the Conversions API.
 *
 * Meta collapses a browser event and a server event into ONE conversion only
 * when the browser's `eventID` is byte-identical to the server's `event_id`.
 * Get it wrong and nothing errors — the conversion is counted twice, ROAS
 * halves, and the ad account optimises against inflated numbers.
 *
 * It lives in web-shared for the same reason `BLOCK_VARIANTS` and
 * `MicrositeData` do: it was written twice. The server derived
 * `{eventName}:{micrositeId}:{dedupeKey}` while the browser minted a random
 * UUID and asserted that two calls produced DIFFERENT ids — so the two halves
 * could never have deduplicated. They also disagreed on the legal charset: the
 * browser's validator rejected `:`, so a server-derived id handed to the page
 * would have been discarded and the pixel silently blocked.
 *
 * One definition, both sides import it.
 */

/** Lowercase and strip anything that could differ between two implementations. */
const part = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');

export interface MicrositeEventIdParts {
  /** The Meta standard event name, verbatim (`PageView`, `Schedule`, …). */
  eventName: string;
  /**
   * Microsite id — deliberately NOT the host. A tenant moving from
   * `salon.borradh.io` to `salon.com` must not break deduplication.
   */
  micrositeId: string;
  /** The thing that happened once in the real world: appointment id, lead id, view id. */
  dedupeKey: string;
}

export const buildMicrositeEventId = ({
  eventName,
  micrositeId,
  dedupeKey,
}: MicrositeEventIdParts): string =>
  `${part(eventName)}:${part(micrositeId)}:${part(dedupeKey)}`;

/**
 * What a valid event id looks like to BOTH halves.
 *
 * Includes `:` because the derived form uses it as the separator. The browser
 * re-validates the id it reads back out of the DOM, so this regex being wrong
 * does not fail loudly — it just drops the pixel.
 */
export const MICROSITE_EVENT_ID_PATTERN = /^[A-Za-z0-9_:-]{8,120}$/;

export const isValidMicrositeEventId = (value: string): boolean =>
  MICROSITE_EVENT_ID_PATTERN.test(value);
