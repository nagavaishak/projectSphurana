import { describe, expect, it } from 'vitest';
import type { FlagProvider } from './provider.js';
import { resolveFlag, staticProvider } from './provider.js';

describe('staticProvider', () => {
  it('returns configured boolean values', async () => {
    const provider = staticProvider({ 'flag-on': true, 'flag-off': false });
    expect(await provider.getFlag('flag-on')).toBe(true);
    expect(await provider.getFlag('flag-off')).toBe(false);
  });

  it('returns undefined for unknown keys (not configured)', async () => {
    const provider = staticProvider({ known: true });
    expect(await provider.getFlag('unknown')).toBeUndefined();
  });

  it('treats an explicit false value as configured (not "missing")', async () => {
    // hasOwnProperty guard: a `false` entry must not be confused with absent.
    const provider = staticProvider({ guarded: false });
    expect(await provider.getFlag('guarded')).toBe(false);
  });
});

describe('resolveFlag', () => {
  it('resolves a configured true via the provider', async () => {
    const provider = staticProvider({ feature: true });
    expect(await resolveFlag(provider, 'feature')).toBe(true);
  });

  it('falls back to safe default (off) for an unknown flag', async () => {
    const provider = staticProvider({});
    expect(await resolveFlag(provider, 'missing')).toBe(false);
  });

  it('honors defaultEnabled for an unknown flag', async () => {
    const provider = staticProvider({});
    expect(
      await resolveFlag(provider, 'missing', undefined, {
        defaultEnabled: true,
      })
    ).toBe(true);
  });

  it('degrades to the safe default when the provider THROWS', async () => {
    const throwing: FlagProvider = {
      getFlag() {
        throw new Error('provider exploded');
      },
    };
    // default-off
    expect(await resolveFlag(throwing, 'any')).toBe(false);
    // respects an inverted safe default
    expect(
      await resolveFlag(throwing, 'any', undefined, { defaultEnabled: true })
    ).toBe(true);
  });

  it('degrades to the safe default when the provider REJECTS (async)', async () => {
    const rejecting: FlagProvider = {
      async getFlag() {
        throw new Error('async eval failed');
      },
    };
    expect(await resolveFlag(rejecting, 'any')).toBe(false);
  });

  it('never throws even on a hostile provider', async () => {
    const hostile: FlagProvider = {
      getFlag() {
        // Throw a non-Error value to exercise the `err as Error` path.
        throw 'string failure';
      },
    };
    await expect(resolveFlag(hostile, 'any')).resolves.toBe(false);
  });
});
