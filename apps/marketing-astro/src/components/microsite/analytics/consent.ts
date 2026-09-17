/**
 * CONSENT AND PIXEL CONFIG — the decisions, with no DOM in sight.
 *
 * Everything in here is pure so the rules that carry the legal weight can be
 * asserted directly: what counts as a usable pixel id, what a stored decision
 * means, and — the one that matters most — that "no decision yet" is NOT
 * consent. See plan §11: IE/UK/EU visitors are on OUR page, so the GDPR
 * liability is ours. The pixel must not be loaded until someone says yes.
 *
 * The DOM half lives in `pixel-runtime.ts`.
 */

/**
 * Bumping this invalidates every stored decision and re-asks. Bump it when the
 * things we ask permission FOR change, never for a cosmetic banner edit.
 */
import { isValidMicrositeEventId } from '@borradh-workspace/web-shared';

export const CONSENT_VERSION = 1;

/**
 * First-party `localStorage`, on the tenant's own host.
 *
 * Deliberately not a cookie: a cookie is itself a thing you need consent for in
 * most readings, and it would travel on every request to the API on this
 * origin. This is a local record of an answer, nothing more — no id, no
 * timestamped profile, nothing that leaves the device.
 */
export const CONSENT_STORAGE_KEY = 'borradh.microsite.consent';

export type ConsentStatus = 'granted' | 'denied';

/** No stored decision is `null` — which is NOT consent. */
export type ConsentDecision = ConsentStatus | null;

export interface StoredConsent {
  status: ConsentStatus;
  version: number;
  /** ISO timestamp. Recorded so a decision is auditable, and so it can expire. */
  at: string;
}

/**
 * A Meta pixel id is a numeric string. Validating it here is not cosmetic:
 * the id is interpolated into an HTML attribute and then into a `fbq('init')`
 * call, and this is the check that means neither can ever carry anything but
 * digits. Anything else is treated as "no pixel configured" — fail closed,
 * because the alternative is shipping an attacker's string into the page.
 */
export const normalisePixelId = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return /^[0-9]{8,20}$/.test(trimmed) ? trimmed : null;
};

/**
 * `eventID` is the deduplication key between the browser event and the CAPI
 * event for the SAME page view. It reaches the DOM and a JS call, so it is
 * restricted to an unambiguous alphabet.
 *
 * The pattern comes from `@borradh-workspace/web-shared` and is SHARED with the
 * server. It had to: the server derives `{eventName}:{micrositeId}:{dedupeKey}`,
 * and the local regex here rejected `:` — so a correctly-derived id handed to
 * this page would have been discarded and the pixel silently dropped. Do not
 * re-localise it.
 */
export const normaliseEventId = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return isValidMicrositeEventId(trimmed) ? trimmed : null;
};

/** A fresh event id. Hyphenated UUID passes `normaliseEventId` unchanged. */
export const newEventId = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `ms-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

/** What the page hands the shell, and what the shell puts in the DOM. */
export interface MicrositeAnalyticsConfig {
  pixelId: string;
  /**
   * THE HAND-OFF. Generated ONCE, server-side, per page render, and used by
   * BOTH the browser `PageView` and the server-side CAPI `PageView`. Two ids
   * for one event means Meta counts it twice.
   */
  pageViewEventId: string;
  /**
   * US visitors: emit `fbq('dataProcessingOptions', ['LDU'], 0, 0)` before
   * init. The page decides, because the page knows the country.
   */
  limitedDataUse?: boolean;
}

export interface ResolveAnalyticsInput {
  pixelId?: string | null;
  /**
   * Pass the id you are ALSO sending to CAPI. Omit it and one is minted here —
   * fine for a browser-only PageView, but then there is nothing to dedupe
   * against, so a server-side twin of this event MUST NOT be sent.
   */
  pageViewEventId?: string | null;
  limitedDataUse?: boolean;
}

/**
 * THE ENTRY POINT FOR A PAGE.
 *
 * ```ts
 * const analytics = resolveMicrositeAnalytics({ pixelId: doc.pixelId });
 * // → hand analytics.pageViewEventId to the CAPI call, and `analytics` to the shell
 * ```
 *
 * Returns `null` when there is no usable pixel, and `null` is what makes a
 * pixel-less microsite render byte-identical to how it renders today: the shell
 * mounts nothing, so there is no banner, no script and no config node.
 */
export const resolveMicrositeAnalytics = (
  input: ResolveAnalyticsInput | null | undefined
): MicrositeAnalyticsConfig | null => {
  const pixelId = normalisePixelId(input?.pixelId);
  if (!pixelId) return null;

  return {
    pixelId,
    pageViewEventId: normaliseEventId(input?.pageViewEventId) ?? newEventId(),
    ...(input?.limitedDataUse ? { limitedDataUse: true } : {}),
  };
};

/**
 * Read a stored decision.
 *
 * ANY doubt reads as "no decision": unreadable storage, malformed JSON, an
 * unknown status, a stale consent version. The failure mode of this function is
 * asking again, never assuming yes.
 */
export const readConsent = (
  storage: Storage | null | undefined
): ConsentDecision => {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(CONSENT_STORAGE_KEY);
  } catch {
    // Safari private mode, storage disabled, quota. Ask again.
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredConsent>;
    if (parsed.version !== CONSENT_VERSION) return null;
    if (parsed.status === 'granted' || parsed.status === 'denied') {
      return parsed.status;
    }
    return null;
  } catch {
    return null;
  }
};

/** Persist a decision. A storage failure is survivable: we ask again next time. */
export const writeConsent = (
  storage: Storage | null | undefined,
  status: ConsentStatus,
  now: Date = new Date()
): void => {
  if (!storage) return;
  const record: StoredConsent = {
    status,
    version: CONSENT_VERSION,
    at: now.toISOString(),
  };
  try {
    storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* nothing to do — the banner will be shown again */
  }
};
