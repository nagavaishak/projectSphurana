import { getMusicTrackById } from '@borradh-workspace/video-templates/music-registry';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { absolutizeMusicUrl, resolveMusicUrl } from './music-url.js';

// `storageEnv` (see packages/env/src/storage.ts) skips Zod validation and
// hands back `process.env` directly whenever `VITEST` is set, so mutating
// `process.env.CDN_URL` here is picked up live by `getPrivateCdnUrl()` — no
// module re-import gymnastics required.
const ORIGINAL_CDN_URL = process.env.CDN_URL;

describe('resolveMusicUrl', () => {
  beforeEach(() => {
    process.env.CDN_URL = 'https://cdn.staging.borradh-testing.com';
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: must unset the env var to restore test isolation
    if (ORIGINAL_CDN_URL === undefined) delete process.env.CDN_URL;
    else process.env.CDN_URL = ORIGINAL_CDN_URL;
  });

  it('regression: organic-video race — musicUrl missing (cdnUrl not loaded yet at submit time), falls back to the registry track path and still yields a defined absolute https:// URL', () => {
    // This is the exact bug: the frontend dialog's `useRuntimeConfig().cdnUrl`
    // was still loading, so `resolvedMusicUrl` was `undefined` even though
    // `musicTrackId` was set correctly (see generate-organic-video-dialog.tsx).
    const track = getMusicTrackById('tea-pop');
    expect(track).toBeDefined();

    const url = resolveMusicUrl(undefined, track?.path);

    expect(url).toBeDefined();
    expect(url).toMatch(/^https:\/\//);
    expect(url).toBe(
      'https://cdn.staging.borradh-testing.com/public/audio/tea-pop.mp3'
    );
  });

  it('falls back to the registry path when musicUrl is an empty string', () => {
    const track = getMusicTrackById('disco-divas');
    const url = resolveMusicUrl('', track?.path);

    expect(url).toBeDefined();
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain('disco-divas.mp3');
  });

  it('prefers an already-absolute musicUrl from the frontend when present', () => {
    const track = getMusicTrackById('smoky');
    const url = resolveMusicUrl(
      'https://cdn.example.com/public/audio/smoky.mp3',
      track?.path
    );

    expect(url).toBe('https://cdn.example.com/public/audio/smoky.mp3');
  });

  it('absolutizes a relative musicUrl from the frontend (legacy race on the URL itself, not just missing it)', () => {
    const track = getMusicTrackById('for-me');
    const url = resolveMusicUrl('/public/audio/for-me.mp3', track?.path);

    expect(url).toBe(
      'https://cdn.staging.borradh-testing.com/public/audio/for-me.mp3'
    );
  });

  it('returns undefined when neither musicUrl nor a track path is available', () => {
    const url = resolveMusicUrl(undefined, undefined);
    expect(url).toBeUndefined();
  });

  it('every organic-template track in the shared registry resolves to a defined absolute https:// URL via the fallback path', () => {
    // caption-tease-1 (and the other organic variations) share this registry
    // (SHARED_MUSIC_TRACKS) — verify the fallback works for every track, not
    // just one, so a future registry entry can't silently regress this.
    const ids = [
      'tea-pop',
      'disco-divas',
      'essence-of-light',
      'for-me',
      'smoky',
      'taka-taka',
      'uncovered',
      'back-then',
      'sweet',
      'leaning-off-your-love',
    ];

    for (const id of ids) {
      const track = getMusicTrackById(id);
      expect(track, `expected registry entry for "${id}"`).toBeDefined();

      const url = resolveMusicUrl(undefined, track?.path);
      expect(url, `resolved url for "${id}"`).toBeDefined();
      expect(url, `resolved url for "${id}" should be absolute https`).toMatch(
        /^https:\/\//
      );
    }
  });
});

describe('absolutizeMusicUrl', () => {
  beforeEach(() => {
    process.env.CDN_URL = 'https://cdn.staging.borradh-testing.com';
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: must unset the env var to restore test isolation
    if (ORIGINAL_CDN_URL === undefined) delete process.env.CDN_URL;
    else process.env.CDN_URL = ORIGINAL_CDN_URL;
  });

  it('passes through an already-absolute URL unchanged', () => {
    expect(absolutizeMusicUrl('https://example.com/x.mp3')).toBe(
      'https://example.com/x.mp3'
    );
    expect(absolutizeMusicUrl('http://example.com/x.mp3')).toBe(
      'http://example.com/x.mp3'
    );
  });

  it('rebuilds an absolute URL from a bare relative path using the worker CDN config', () => {
    expect(absolutizeMusicUrl('/public/audio/tea-pop.mp3')).toBe(
      'https://cdn.staging.borradh-testing.com/public/audio/tea-pop.mp3'
    );
  });

  it('returns undefined for undefined input', () => {
    expect(absolutizeMusicUrl(undefined)).toBeUndefined();
  });

  it('falls back to the raw relative path (does not throw) when CDN_URL is not configured', () => {
    // biome-ignore lint/performance/noDelete: must unset the env var to test the unconfigured fallback
    delete process.env.CDN_URL;
    expect(absolutizeMusicUrl('/public/audio/tea-pop.mp3')).toBe(
      '/public/audio/tea-pop.mp3'
    );
  });
});
