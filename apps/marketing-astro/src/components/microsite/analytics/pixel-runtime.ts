/**
 * CONSENT BANNER + META PIXEL — the DOM half.
 *
 * Loaded ONLY by `MicrositeAnalytics.astro`, which the shell mounts only when
 * the microsite has a valid pixel id. A tenant with no pixel never imports
 * this module, so Astro emits no bundle of it on their pages: the zero-client-JS
 * budget is kept by the code not being on the page, not by a runtime flag.
 *
 * The rule this file exists to enforce: **nothing Meta-shaped happens before
 * consent.** Not "loaded but inactive", not "queued" — `fbevents.js` is not
 * requested, `fbq` does not exist, and no cookie is written, until a visitor
 * clicks accept (or clicked it on a previous visit).
 *
 * All the decisions live in `./consent.ts` and are unit tested there.
 */

import {
  type ConsentStatus,
  type MicrositeAnalyticsConfig,
  normaliseEventId,
  normalisePixelId,
  readConsent,
  writeConsent,
} from './consent';

/** The one third-party origin this whole feature adds. Mirrored in vercel.json. */
export const PIXEL_SCRIPT_SRC =
  'https://connect.facebook.net/en_US/fbevents.js';

export const CONFIG_ID = 'ms-analytics-config';
export const BANNER_ID = 'ms-consent';
export const REOPEN_ID = 'ms-consent-reopen';

export interface AnalyticsRuntimeOptions {
  doc?: Document;
  /**
   * Injectable so a test can supply a throwing or empty store. Defaults to
   * `localStorage`, read defensively — Safari private mode throws on access.
   */
  storage?: Storage | null;
}

export interface AnalyticsRuntime {
  /** `null` when the page carries no usable pixel config. */
  config: MicrositeAnalyticsConfig | null;
  /** Whether `fbevents.js` has been requested in this page's lifetime. */
  isPixelLoaded: () => boolean;
  stop: () => void;
}

/** Read the config the shell put in the DOM, re-validating every field. */
export const readConfigElement = (
  doc: Document
): MicrositeAnalyticsConfig | null => {
  const el = doc.getElementById(CONFIG_ID);
  if (!el) return null;

  const pixelId = normalisePixelId(el.dataset.pixelId);
  const pageViewEventId = normaliseEventId(el.dataset.eventId);
  // No event id means no dedupe key, and a browser PageView that cannot be
  // matched to its CAPI twin is exactly the double-count we are avoiding.
  if (!pixelId || !pageViewEventId) return null;

  return {
    pixelId,
    pageViewEventId,
    ...(el.dataset.ldu === '1' ? { limitedDataUse: true } : {}),
  };
};

const safeStorage = (doc: Document): Storage | null => {
  try {
    return doc.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
};

interface PixelWindow extends Window {
  fbq?: ((...args: unknown[]) => void) & {
    callMethod?: (...args: unknown[]) => void;
    queue?: unknown[];
    push?: unknown;
    loaded?: boolean;
    version?: string;
  };
  _fbq?: unknown;
}

/**
 * The standard Meta snippet, run only once and only after consent.
 *
 * `eventID` on the `PageView` is the load-bearing part: it must be the SAME
 * string the server sends to CAPI for this page view, or Meta counts the view
 * twice and every downstream optimisation is fed inflated numbers.
 */
const loadPixel = (
  doc: Document,
  config: MicrositeAnalyticsConfig
): boolean => {
  const win = doc.defaultView as PixelWindow | null;
  if (!win) return false;
  if (win.fbq) return false; // already initialised on this page

  const fbq = function (this: unknown, ...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod.apply(fbq, args);
    else fbq.queue?.push(args);
  } as NonNullable<PixelWindow['fbq']>;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  win.fbq = fbq;
  win._fbq ??= fbq;

  const tag = doc.createElement('script');
  tag.async = true;
  tag.src = PIXEL_SCRIPT_SRC;
  const first = doc.getElementsByTagName('script')[0];
  if (first?.parentNode) first.parentNode.insertBefore(tag, first);
  else doc.head.appendChild(tag);

  // US visitors: Limited Data Use. Must precede `init`.
  if (config.limitedDataUse) {
    fbq('dataProcessingOptions', ['LDU'], 0, 0);
  }
  fbq('init', config.pixelId);
  fbq('track', 'PageView', {}, { eventID: config.pageViewEventId });

  return true;
};

const show = (el: Element | null) => el?.removeAttribute('hidden');
const hide = (el: Element | null) => el?.setAttribute('hidden', '');

export function startMicrositeAnalytics(
  options: AnalyticsRuntimeOptions = {}
): AnalyticsRuntime {
  const doc = options.doc ?? document;
  const storage =
    options.storage === undefined ? safeStorage(doc) : options.storage;

  const config = readConfigElement(doc);
  const banner = doc.getElementById(BANNER_ID);
  const reopen = doc.getElementById(REOPEN_ID);

  let loaded = false;

  // Fail CLOSED. A page with a broken or absent config gets no banner (there is
  // nothing to ask about) and, obviously, no pixel.
  if (!config) {
    hide(banner);
    hide(reopen);
    return { config: null, isPixelLoaded: () => false, stop: () => undefined };
  }

  const decide = (status: ConsentStatus) => {
    writeConsent(storage, status);
    hide(banner);
    show(reopen);
    if (status === 'granted') loaded = loadPixel(doc, config) || loaded;
  };

  const onClick = (event: Event) => {
    const target = (event.target as Element | null)?.closest?.(
      '[data-ms-consent-action]'
    );
    const action = (target as HTMLElement | null)?.dataset.msConsentAction;
    if (action === 'accept') decide('granted');
    else if (action === 'decline') decide('denied');
    else if (action === 'reopen') {
      // Re-offerable: a decision can always be revisited, including a granted
      // one. Withdrawal has to be as available as consent was.
      hide(reopen);
      show(banner);
    }
  };

  doc.addEventListener('click', onClick);

  const decision = readConsent(storage);
  if (decision === 'granted') {
    hide(banner);
    show(reopen);
    loaded = loadPixel(doc, config);
  } else if (decision === 'denied') {
    hide(banner);
    show(reopen);
  } else {
    // No decision. Ask, and load nothing.
    show(banner);
    hide(reopen);
  }

  return {
    config,
    isPixelLoaded: () => loaded,
    stop: () => doc.removeEventListener('click', onClick),
  };
}
