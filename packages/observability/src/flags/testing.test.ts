import { describe, expect, it } from 'vitest';
import { resolveFlag } from './provider.js';
import { allFlagsOff, allFlagsOn, withFlags } from './testing.js';

describe('withFlags', () => {
  it('returns a provider that reports configured booleans', async () => {
    const provider = withFlags({ 'flag-on': true, 'flag-off': false });
    expect(await provider.getFlag('flag-on')).toBe(true);
    expect(await provider.getFlag('flag-off')).toBe(false);
  });

  it('returns undefined for flags not in the map (→ safe default)', async () => {
    const provider = withFlags({ known: true });
    expect(await provider.getFlag('unknown')).toBeUndefined();
  });

  it('defaults to an empty map (every flag off)', async () => {
    const provider = withFlags();
    expect(await provider.getFlag('anything')).toBeUndefined();
  });

  it('drives a flag-guarded path ON through resolveFlag', async () => {
    const provider = withFlags({ 'http-retry-v2': true });
    expect(
      await resolveFlag(provider, 'http-retry-v2', { unitId: 'org_1' })
    ).toBe(true);
  });

  it('resolves to the safe default (OFF) for an unset flag — the CI default', async () => {
    const provider = withFlags({});
    expect(
      await resolveFlag(provider, 'http-retry-v2', { unitId: 'org_1' })
    ).toBe(false);
  });
});

describe('allFlagsOff', () => {
  it('resolves every flag to the safe default through resolveFlag', async () => {
    const provider = allFlagsOff();
    expect(await provider.getFlag('a')).toBeUndefined();
    expect(await resolveFlag(provider, 'a', { unitId: 'u' })).toBe(false);
  });
});

describe('allFlagsOn', () => {
  it('forces only the listed flags on', async () => {
    const provider = allFlagsOn('flag-a', 'flag-b');
    expect(await provider.getFlag('flag-a')).toBe(true);
    expect(await provider.getFlag('flag-b')).toBe(true);
    expect(await provider.getFlag('flag-c')).toBeUndefined();
  });

  it('with no keys behaves like allFlagsOff', async () => {
    const provider = allFlagsOn();
    expect(await provider.getFlag('anything')).toBeUndefined();
  });
});
