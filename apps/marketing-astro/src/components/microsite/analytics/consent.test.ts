/**
 * The decisions that carry the legal weight, asserted directly.
 *
 * The one that matters most: "no stored decision" must read as NOT consent, by
 * every route into that state — empty storage, unreadable storage, junk,
 * an unknown status, a stale version.
 */
import { describe, expect, it } from 'vitest';
import {
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  newEventId,
  normaliseEventId,
  normalisePixelId,
  readConsent,
  resolveMicrositeAnalytics,
  writeConsent,
} from './consent';

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

const throwingStorage = (): Storage =>
  ({
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('SecurityError');
    },
  }) as unknown as Storage;

describe('normalisePixelId', () => {
  it('accepts a numeric Meta pixel id', () => {
    expect(normalisePixelId('1234567890123456')).toBe('1234567890123456');
    expect(normalisePixelId('  1234567890123456  ')).toBe('1234567890123456');
  });

  it('rejects anything that is not digits — this is the injection guard', () => {
    for (const bad of [
      '12345678"><script>alert(1)</script>',
      "123456789'); fbq('track','x",
      'abcdefgh',
      '123', // too short to be a real id
      '',
      null,
      undefined,
      12345678,
      {},
    ]) {
      expect(normalisePixelId(bad)).toBeNull();
    }
  });
});

describe('normaliseEventId', () => {
  it('accepts a uuid unchanged', () => {
    const id = '3f1a9e1c-6a2b-4f0e-9d33-1a2b3c4d5e6f';
    expect(normaliseEventId(id)).toBe(id);
  });

  it('rejects quotes, spaces and markup', () => {
    for (const bad of ['a b c d e f g h', '"><img>', "x');fbq(", 'short', 42]) {
      expect(normaliseEventId(bad)).toBeNull();
    }
  });

  it('mints ids that pass its own validator', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(normaliseEventId(newEventId())).not.toBeNull();
    }
  });
});

describe('resolveMicrositeAnalytics', () => {
  it('returns null with no pixel — the "renders exactly as today" contract', () => {
    expect(resolveMicrositeAnalytics(null)).toBeNull();
    expect(resolveMicrositeAnalytics(undefined)).toBeNull();
    expect(resolveMicrositeAnalytics({})).toBeNull();
    expect(resolveMicrositeAnalytics({ pixelId: null })).toBeNull();
    expect(resolveMicrositeAnalytics({ pixelId: 'not-a-pixel' })).toBeNull();
  });

  it('keeps the caller’s event id — the CAPI dedupe key', () => {
    const eventId = '3f1a9e1c-6a2b-4f0e-9d33-1a2b3c4d5e6f';
    const resolved = resolveMicrositeAnalytics({
      pixelId: '1234567890123456',
      pageViewEventId: eventId,
    });
    expect(resolved?.pageViewEventId).toBe(eventId);
  });

  it('mints one when the caller has none, and never repeats it', () => {
    const a = resolveMicrositeAnalytics({ pixelId: '1234567890123456' });
    const b = resolveMicrositeAnalytics({ pixelId: '1234567890123456' });
    expect(a?.pageViewEventId).toBeTruthy();
    expect(a?.pageViewEventId).not.toBe(b?.pageViewEventId);
  });

  it('carries limitedDataUse only when asked', () => {
    expect(
      resolveMicrositeAnalytics({ pixelId: '1234567890123456' })?.limitedDataUse
    ).toBeUndefined();
    expect(
      resolveMicrositeAnalytics({
        pixelId: '1234567890123456',
        limitedDataUse: true,
      })?.limitedDataUse
    ).toBe(true);
  });
});

describe('readConsent — silence is never consent', () => {
  it('returns null for empty storage', () => {
    expect(readConsent(memoryStorage())).toBeNull();
  });

  it('returns null when there is no storage at all', () => {
    expect(readConsent(null)).toBeNull();
    expect(readConsent(undefined)).toBeNull();
  });

  it('returns null when storage throws (Safari private mode)', () => {
    expect(readConsent(throwingStorage())).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(
      readConsent(memoryStorage({ [CONSENT_STORAGE_KEY]: 'granted' }))
    ).toBeNull();
  });

  it('returns null for an unknown status', () => {
    expect(
      readConsent(
        memoryStorage({
          [CONSENT_STORAGE_KEY]: JSON.stringify({
            status: 'maybe',
            version: CONSENT_VERSION,
          }),
        })
      )
    ).toBeNull();
  });

  it('returns null for a stale consent version — a bump re-asks', () => {
    expect(
      readConsent(
        memoryStorage({
          [CONSENT_STORAGE_KEY]: JSON.stringify({
            status: 'granted',
            version: CONSENT_VERSION - 1,
            at: new Date().toISOString(),
          }),
        })
      )
    ).toBeNull();
  });

  it('reads back what writeConsent wrote, both ways', () => {
    for (const status of ['granted', 'denied'] as const) {
      const storage = memoryStorage();
      writeConsent(storage, status);
      expect(readConsent(storage)).toBe(status);
    }
  });

  it('survives a storage that cannot be written to', () => {
    expect(() => writeConsent(throwingStorage(), 'granted')).not.toThrow();
    expect(() => writeConsent(null, 'granted')).not.toThrow();
  });

  it('records a timestamp so a decision is auditable', () => {
    const storage = memoryStorage();
    writeConsent(storage, 'granted', new Date('2026-01-02T03:04:05.000Z'));
    expect(JSON.parse(storage.getItem(CONSENT_STORAGE_KEY) as string)).toEqual({
      status: 'granted',
      version: CONSENT_VERSION,
      at: '2026-01-02T03:04:05.000Z',
    });
  });
});

describe('event id compatibility with the server', () => {
  it('ACCEPTS a server-derived id', () => {
    // The server builds `{eventName}:{micrositeId}:{dedupeKey}`. A local regex
    // here once rejected the colon, which would have discarded every correctly
    // derived id and silently dropped the pixel — with the visible symptom
    // being double-counted conversions, not an error.
    expect(normaliseEventId('pageview:ms_abc123:view_def456')).toBe(
      'pageview:ms_abc123:view_def456'
    );
    expect(normaliseEventId('schedule:ms_abc123:appt_789')).toBe(
      'schedule:ms_abc123:appt_789'
    );
  });

  it('still rejects ids that could break out of an attribute or a JS call', () => {
    expect(normaliseEventId('bad id with spaces')).toBeNull();
    expect(normaliseEventId('"><script>alert(1)</script>')).toBeNull();
    expect(normaliseEventId("'+alert(1)+'")).toBeNull();
    expect(normaliseEventId('short')).toBeNull();
  });
});
