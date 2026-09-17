/**
 * @vitest-environment jsdom
 *
 * THE HARD REQUIREMENT, AS ASSERTIONS.
 *
 * Consent not given → no `fbevents.js` script in the document, no `fbq` on
 * `window`, no cookie. Consent given → the script, with `init` carrying the
 * configured pixel id and `PageView` carrying the SAME `eventID` the server
 * put in the config node.
 *
 * `fbq` is captured rather than stubbed: the runtime installs the real Meta
 * queue shim, and the calls it makes land in `fbq.queue` because
 * `fbevents.js` itself never loads in jsdom. So these assertions read the
 * actual argument lists the pixel would have received.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONSENT_STORAGE_KEY, CONSENT_VERSION, writeConsent } from './consent';
import {
  BANNER_ID,
  PIXEL_SCRIPT_SRC,
  REOPEN_ID,
  startMicrositeAnalytics,
} from './pixel-runtime';

const PIXEL_ID = '1234567890123456';
const EVENT_ID = '3f1a9e1c-6a2b-4f0e-9d33-1a2b3c4d5e6f';

let stop: (() => void) | null = null;

const memoryStorage = (initial: Record<string, string> = {}): Storage => {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
};

/**
 * The markup the runtime keys on. `microsite-analytics.render.test.ts` asserts
 * that `MicrositeAnalytics.astro` really emits these ids and attributes, so
 * this fixture cannot silently drift from the component.
 */
const CONFIG_MARKUP = (attrs: string) => `
  <div id="ms-analytics-config" ${attrs} hidden></div>
  <div id="ms-consent" hidden>
    <button type="button" data-ms-consent-action="decline">Decline</button>
    <button type="button" data-ms-consent-action="accept">Accept</button>
  </div>
  <button id="ms-consent-reopen" type="button" data-ms-consent-action="reopen" hidden>
    Cookie settings
  </button>
`;

const mount = ({
  storage = memoryStorage(),
  attrs = `data-pixel-id="${PIXEL_ID}" data-event-id="${EVENT_ID}"`,
} = {}) => {
  document.body.innerHTML = CONFIG_MARKUP(attrs);
  const runtime = startMicrositeAnalytics({ storage });
  stop = runtime.stop;
  return { runtime, storage };
};

const pixelScripts = () =>
  Array.from(document.querySelectorAll('script')).filter((s) =>
    (s.getAttribute('src') ?? '').includes('facebook')
  );

const fbqCalls = (): unknown[][] => {
  const fbq = (window as unknown as { fbq?: { queue?: unknown[][] } }).fbq;
  return (fbq?.queue ?? []) as unknown[][];
};

const click = (selector: string) =>
  document.querySelector<HTMLElement>(selector)?.click();

const banner = () => document.getElementById(BANNER_ID) as HTMLElement;
const reopen = () => document.getElementById(REOPEN_ID) as HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  for (const name of document.cookie
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter(Boolean)) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
  (window as unknown as Record<string, unknown>).fbq = undefined;
  (window as unknown as Record<string, unknown>)._fbq = undefined;
});

afterEach(() => {
  stop?.();
  stop = null;
});

describe('no consent → nothing Meta-shaped happens', () => {
  it('requests no pixel script, defines no fbq, sets no cookie', () => {
    const { runtime } = mount();

    expect(runtime.isPixelLoaded()).toBe(false);
    expect(pixelScripts()).toHaveLength(0);
    expect(document.documentElement.innerHTML).not.toContain(PIXEL_SCRIPT_SRC);
    expect((window as unknown as { fbq?: unknown }).fbq).toBeUndefined();
    expect(document.cookie).toBe('');
  });

  it('shows the banner and hides the reopener', () => {
    mount();
    expect(banner().hasAttribute('hidden')).toBe(false);
    expect(reopen().hasAttribute('hidden')).toBe(true);
  });

  it('stays loaded-free when storage is unreadable', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;

    const { runtime } = mount({ storage: throwing });
    expect(runtime.isPixelLoaded()).toBe(false);
    expect(pixelScripts()).toHaveLength(0);
    expect(banner().hasAttribute('hidden')).toBe(false);
  });
});

describe('declining loads nothing, and is one click', () => {
  it('records the decision and requests no pixel', () => {
    const { runtime, storage } = mount();

    click('[data-ms-consent-action="decline"]');

    expect(runtime.isPixelLoaded()).toBe(false);
    expect(pixelScripts()).toHaveLength(0);
    expect((window as unknown as { fbq?: unknown }).fbq).toBeUndefined();
    expect(storage.getItem(CONSENT_STORAGE_KEY)).toContain('denied');
    expect(banner().hasAttribute('hidden')).toBe(true);
  });

  it('is offered as the same element type as accept, side by side', () => {
    mount();
    const buttons = Array.from(
      banner().querySelectorAll<HTMLElement>('[data-ms-consent-action]')
    );
    expect(buttons.map((b) => b.dataset.msConsentAction)).toEqual([
      'decline',
      'accept',
    ]);
    expect(new Set(buttons.map((b) => b.tagName))).toEqual(new Set(['BUTTON']));
  });

  it('a stored decline is honoured on the next page load', () => {
    const storage = memoryStorage();
    writeConsent(storage, 'denied');

    const { runtime } = mount({ storage });

    expect(runtime.isPixelLoaded()).toBe(false);
    expect(pixelScripts()).toHaveLength(0);
    expect(banner().hasAttribute('hidden')).toBe(true);
    expect(reopen().hasAttribute('hidden')).toBe(false);
  });
});

describe('accepting loads the pixel, with the right ids', () => {
  it('injects fbevents.js exactly once', () => {
    const { runtime } = mount();

    click('[data-ms-consent-action="accept"]');

    expect(runtime.isPixelLoaded()).toBe(true);
    const scripts = pixelScripts();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].getAttribute('src')).toBe(PIXEL_SCRIPT_SRC);
    expect(scripts[0].async).toBe(true);
  });

  it('inits with the configured pixel id', () => {
    mount();
    click('[data-ms-consent-action="accept"]');

    expect(fbqCalls()).toContainEqual(['init', PIXEL_ID]);
  });

  it('tracks PageView with the SAME eventID the server put in the config', () => {
    mount();
    click('[data-ms-consent-action="accept"]');

    const pageView = fbqCalls().find(
      (call) => call[0] === 'track' && call[1] === 'PageView'
    );
    expect(pageView).toBeDefined();
    expect(pageView?.[3]).toEqual({ eventID: EVENT_ID });
  });

  it('fires PageView and nothing else — no conversion is invented here', () => {
    mount();
    click('[data-ms-consent-action="accept"]');

    const tracked = fbqCalls()
      .filter((call) => call[0] === 'track' || call[0] === 'trackCustom')
      .map((call) => call[1]);
    expect(tracked).toEqual(['PageView']);
  });

  it('emits Limited Data Use before init when the page asked for it', () => {
    mount({
      attrs: `data-pixel-id="${PIXEL_ID}" data-event-id="${EVENT_ID}" data-ldu="1"`,
    });
    click('[data-ms-consent-action="accept"]');

    const calls = fbqCalls();
    const lduIndex = calls.findIndex((c) => c[0] === 'dataProcessingOptions');
    const initIndex = calls.findIndex((c) => c[0] === 'init');
    expect(lduIndex).toBeGreaterThanOrEqual(0);
    expect(calls[lduIndex]).toEqual(['dataProcessingOptions', ['LDU'], 0, 0]);
    expect(lduIndex).toBeLessThan(initIndex);
  });

  it('omits Limited Data Use otherwise', () => {
    mount();
    click('[data-ms-consent-action="accept"]');
    expect(fbqCalls().some((c) => c[0] === 'dataProcessingOptions')).toBe(
      false
    );
  });

  it('a stored grant loads the pixel on the next page load, with no banner', () => {
    const storage = memoryStorage();
    writeConsent(storage, 'granted');

    const { runtime } = mount({ storage });

    expect(runtime.isPixelLoaded()).toBe(true);
    expect(pixelScripts()).toHaveLength(1);
    expect(fbqCalls()).toContainEqual(['init', PIXEL_ID]);
    expect(banner().hasAttribute('hidden')).toBe(true);
  });
});

describe('the choice is re-offerable', () => {
  it('reopens the banner after a decision, both ways', () => {
    for (const first of ['accept', 'decline'] as const) {
      document.body.innerHTML = '';
      (window as unknown as Record<string, unknown>).fbq = undefined;
      const { runtime } = mount();
      click(`[data-ms-consent-action="${first}"]`);
      expect(banner().hasAttribute('hidden')).toBe(true);
      expect(reopen().hasAttribute('hidden')).toBe(false);

      click(`#${REOPEN_ID}`);
      expect(banner().hasAttribute('hidden')).toBe(false);
      runtime.stop();
    }
  });

  it('a later decline stops the NEXT page load from firing', () => {
    const { storage } = mount();
    click('[data-ms-consent-action="accept"]');
    click(`#${REOPEN_ID}`);
    click('[data-ms-consent-action="decline"]');
    expect(storage.getItem(CONSENT_STORAGE_KEY)).toContain('denied');

    // A genuinely fresh page load: new document, no leftover fbq. Only the
    // storage — which is what actually survives a navigation — carries over.
    stop?.();
    (window as unknown as Record<string, unknown>).fbq = undefined;
    (window as unknown as Record<string, unknown>)._fbq = undefined;
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    const { runtime } = mount({ storage });
    expect(runtime.isPixelLoaded()).toBe(false);
    expect(pixelScripts()).toHaveLength(0);
  });
});

describe('a page with no usable config does nothing at all', () => {
  it('no config node → no banner, no pixel', () => {
    document.body.innerHTML = '';
    const runtime = startMicrositeAnalytics({ storage: memoryStorage() });
    stop = runtime.stop;

    expect(runtime.config).toBeNull();
    expect(runtime.isPixelLoaded()).toBe(false);
    expect(pixelScripts()).toHaveLength(0);
  });

  it('a non-numeric pixel id is treated as no pixel, even with consent stored', () => {
    const storage = memoryStorage();
    writeConsent(storage, 'granted');

    const { runtime } = mount({
      storage,
      attrs: `data-pixel-id="123');alert(1)//" data-event-id="${EVENT_ID}"`,
    });

    expect(runtime.config).toBeNull();
    expect(runtime.isPixelLoaded()).toBe(false);
    expect(pixelScripts()).toHaveLength(0);
    expect(banner().hasAttribute('hidden')).toBe(true);
  });

  it('a missing event id blocks the pixel — an undedupable event is worse than none', () => {
    const storage = memoryStorage();
    writeConsent(storage, 'granted');

    const { runtime } = mount({
      storage,
      attrs: `data-pixel-id="${PIXEL_ID}"`,
    });

    expect(runtime.config).toBeNull();
    expect(runtime.isPixelLoaded()).toBe(false);
    expect(pixelScripts()).toHaveLength(0);
  });

  it('a stale consent version re-asks rather than firing', () => {
    const storage = memoryStorage({
      [CONSENT_STORAGE_KEY]: JSON.stringify({
        status: 'granted',
        version: CONSENT_VERSION - 1,
        at: new Date().toISOString(),
      }),
    });

    const { runtime } = mount({ storage });
    expect(runtime.isPixelLoaded()).toBe(false);
    expect(banner().hasAttribute('hidden')).toBe(false);
  });
});
