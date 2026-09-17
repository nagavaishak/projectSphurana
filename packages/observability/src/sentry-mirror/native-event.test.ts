// The native/JS discrimination is the whole mirror. Too permissive and PostHog
// fills with duplicates of JS errors posthog-js already captured; too strict and
// the mirror silently carries nothing. Both failures are quiet.
import { describe, expect, it } from 'vitest';
import {
  type SentryApiEvent,
  isNativeOriginEvent,
  toPostHogException,
} from './native-event.js';

describe('isNativeOriginEvent', () => {
  it('mirrors iOS native crashes', () => {
    expect(isNativeOriginEvent({ sdk: { name: 'sentry.cocoa' } })).toBe(true);
    // `sentry.cocoa.capacitor` is the REAL sdk name on the WEB-3D App Hang,
    // read from the Sentry API on 2026-08-17.
    expect(
      isNativeOriginEvent({ sdk: { name: 'sentry.cocoa.capacitor' } })
    ).toBe(true);
  });

  it('does NOT mirror the real 4-segment JS sdk name', () => {
    // `sentry.javascript.react.capacitor` is the REAL name on WEB-21, also read
    // from the API. Pinned separately because it is a deeper name than the
    // 3-segment ones and any prefix logic must still exclude it.
    expect(
      isNativeOriginEvent({
        sdk: { name: 'sentry.javascript.react.capacitor' },
        platform: 'javascript',
      })
    ).toBe(false);
  });

  it('mirrors Android native crashes and ANRs', () => {
    expect(isNativeOriginEvent({ sdk: { name: 'sentry.java.android' } })).toBe(
      true
    );
    expect(isNativeOriginEvent({ sdk: { name: 'sentry.native' } })).toBe(true);
  });

  it('does NOT mirror JS events — posthog-js already has them', () => {
    // The duplicate-every-error case.
    expect(
      isNativeOriginEvent({ sdk: { name: 'sentry.javascript.capacitor' } })
    ).toBe(false);
    expect(
      isNativeOriginEvent({ sdk: { name: 'sentry.javascript.react' } })
    ).toBe(false);
  });

  it('does NOT mirror a JS error just because it came from a phone', () => {
    // `runtime: ios` is set on JS-layer events from a device too, which is
    // exactly why this predicate keys on the SDK and not on our own tags.
    expect(
      isNativeOriginEvent({
        sdk: { name: 'sentry.javascript.capacitor' },
        platform: 'javascript',
        tags: [{ key: 'runtime', value: 'ios' }],
      })
    ).toBe(false);
  });

  it('decides on platform alone — the PRODUCTION shape', () => {
    // The project events LIST endpoint the mirror actually calls returns no
    // `sdk` field at all (verified against the live API, 2026-08-17), so this
    // is the branch that runs in production. If it regresses, the mirror
    // silently carries nothing — or silently carries everything.
    expect(isNativeOriginEvent({ platform: 'cocoa' })).toBe(true);
    expect(isNativeOriginEvent({ platform: 'java' })).toBe(true);
    expect(isNativeOriginEvent({ platform: 'javascript' })).toBe(false);
  });

  it('matches the REAL list-endpoint App Hang, sdk absent and all', () => {
    // Copied from the live payload: the fields the list endpoint actually
    // returns, with no `sdk` key. This is precisely what production sees.
    expect(
      isNativeOriginEvent({
        eventID: '5b0b048ef2ae49d293a86997a09c64fa',
        platform: 'cocoa',
        title:
          'App Hang Fully Blocked: App hanging between 181.3 and 182.1 seconds.',
        culprit: '?',
        metadata: {
          type: 'App Hang Fully Blocked',
          value: 'App hanging between 181.3 and 182.1 seconds.',
        },
        tags: [
          { key: 'os', value: 'iOS 26.6' },
          { key: 'device', value: 'iPhone14,5' },
        ],
      })
    ).toBe(true);
  });

  it('fails CLOSED when neither signal is present', () => {
    // An unmirrored event is a visible gap someone can notice. A wrongly
    // mirrored one quietly degrades every count in PostHog.
    expect(isNativeOriginEvent({})).toBe(false);
    expect(isNativeOriginEvent({ title: 'something' })).toBe(false);
  });

  it('prefers sdk over platform when they disagree', () => {
    // A JS event on a native platform string must not be mirrored.
    expect(
      isNativeOriginEvent({
        sdk: { name: 'sentry.javascript.capacitor' },
        platform: 'cocoa',
      })
    ).toBe(false);
  });
});

describe('toPostHogException', () => {
  const event: SentryApiEvent = {
    eventID: 'abc123',
    platform: 'cocoa',
    title: 'App Hang Fully Blocked',
    culprit: 'main',
    sdk: { name: 'sentry.cocoa' },
    metadata: { type: 'App Hang Fully Blocked', value: 'App hanging for 2s' },
    tags: [
      { key: 'release', value: '1.4.2' },
      { key: 'os', value: 'iOS 26.6' },
      { key: 'device', value: 'iPhone14,5' },
      { key: 'environment', value: 'production' },
    ],
  };

  it('carries Sentry’s own type and message so both systems group alike', () => {
    // Cross-referencing an incident between Sentry and PostHog is the entire
    // value of mirroring, and it breaks the moment the titles diverge.
    const { error } = toPostHogException(event);
    expect(error.name).toBe('App Hang Fully Blocked');
    expect(error.message).toBe('App hanging for 2s');
  });

  it('carries NO stack rather than a fabricated one', () => {
    // A native crash has no JS stack; a synthesized one would point at the
    // mirror and send someone debugging the wrong file.
    const { error } = toPostHogException(event);
    expect(error.stack).toBeUndefined();
  });

  it('marks provenance and keeps the Sentry id for cross-referencing', () => {
    const { properties } = toPostHogException(event);
    expect(properties.mirrored_from).toBe('sentry');
    expect(properties.sentry_event_id).toBe('abc123');
    expect(properties.service).toBe('mobile-native');
    expect(properties.release).toBe('1.4.2');
    // os/device are what a native event actually carries. There is deliberately
    // NO `runtime` — that tag comes from our JS init, so it appears only on
    // JS-origin events (the real WEB-3D App Hang has none).
    expect(properties.os).toBe('iOS 26.6');
    expect(properties.device).toBe('iPhone14,5');
    expect(properties.runtime).toBeUndefined();
  });

  it('keeps Sentry’s environment, not the mirroring process’s', () => {
    // A crash that happened in production must stay tagged production even
    // though the mirror runs inside the production API's own process.
    const { properties } = toPostHogException(event);
    expect(properties.environment).toBe('production');
  });

  it('falls back through title then type when metadata is thin', () => {
    const { error } = toPostHogException({
      eventID: 'x',
      title: 'Only a title',
      sdk: { name: 'sentry.cocoa' },
    });
    expect(error.message).toBe('Only a title');
    expect(error.name).toBe('NativeCrash');
  });
});
