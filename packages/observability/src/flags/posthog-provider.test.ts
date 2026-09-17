import { describe, expect, it, vi } from 'vitest';
import { resolveFlag } from './provider.js';

// Mock the real helper so we can also exercise the DEFAULT (no-deps) wiring path
// without a live PostHog. DI (the `deps` arg) covers the rest.
const getFeatureFlag = vi.fn();
vi.mock('../posthog/index.js', () => ({
  getFeatureFlag: (...args: unknown[]) => getFeatureFlag(...args),
}));

import { postHogFlagProvider } from './posthog-provider.js';

describe('postHogFlagProvider (injected deps)', () => {
  it('returns the boolean flag value when the client resolves true', async () => {
    const deps = { getFeatureFlag: vi.fn().mockResolvedValue(true) };
    const provider = postHogFlagProvider(deps);

    await expect(
      provider.getFlag('http-retry-v2', { unitId: 'org_1' })
    ).resolves.toBe(true);
  });

  it('returns false when the client resolves a definitive false', async () => {
    const deps = { getFeatureFlag: vi.fn().mockResolvedValue(false) };
    const provider = postHogFlagProvider(deps);

    await expect(provider.getFlag('flag', { unitId: 'org_1' })).resolves.toBe(
      false
    );
  });

  it('passes the unitId as the distinctId and forwards groups/properties', async () => {
    const spy = vi.fn().mockResolvedValue(true);
    const provider = postHogFlagProvider({ getFeatureFlag: spy });

    await provider.getFlag('canary', {
      unitId: 'org_42',
      groups: { organization: 'org_42' },
      properties: { plan: 'pro' },
    });

    expect(spy).toHaveBeenCalledWith('org_42', 'canary', {
      groups: { organization: 'org_42' },
      personProperties: { plan: 'pro' },
    });
  });

  it('omits options entirely when no groups/properties are supplied', async () => {
    const spy = vi.fn().mockResolvedValue(true);
    const provider = postHogFlagProvider({ getFeatureFlag: spy });

    await provider.getFlag('flag', { unitId: 'user_1' });

    expect(spy).toHaveBeenCalledWith('user_1', 'flag', undefined);
  });

  it('degrades to undefined (no opinion) when the client THROWS', async () => {
    const deps = {
      getFeatureFlag: vi.fn().mockRejectedValue(new Error('SDK down')),
    };
    const provider = postHogFlagProvider(deps);

    await expect(
      provider.getFlag('flag', { unitId: 'org_1' })
    ).resolves.toBeUndefined();
  });

  it('returns undefined when the flag is unconfigured (client returns undefined)', async () => {
    const deps = { getFeatureFlag: vi.fn().mockResolvedValue(undefined) };
    const provider = postHogFlagProvider(deps);

    await expect(
      provider.getFlag('missing', { unitId: 'org_1' })
    ).resolves.toBeUndefined();
  });

  it('coerces a multivariate STRING value to undefined (boolean-only contract)', async () => {
    const deps = { getFeatureFlag: vi.fn().mockResolvedValue('variant-b') };
    const provider = postHogFlagProvider(deps);

    await expect(
      provider.getFlag('experiment', { unitId: 'org_1' })
    ).resolves.toBeUndefined();
  });

  it('returns undefined without calling PostHog when unitId is missing', async () => {
    const spy = vi.fn();
    const provider = postHogFlagProvider({ getFeatureFlag: spy });

    await expect(provider.getFlag('flag')).resolves.toBeUndefined();
    await expect(
      provider.getFlag('flag', { groups: { organization: 'o' } })
    ).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('postHogFlagProvider (default wiring + resolveFlag integration)', () => {
  it('uses the real getFeatureFlag helper when no deps are injected', async () => {
    getFeatureFlag.mockReset();
    getFeatureFlag.mockResolvedValue(true);
    const provider = postHogFlagProvider();

    await expect(provider.getFlag('flag', { unitId: 'org_1' })).resolves.toBe(
      true
    );
    expect(getFeatureFlag).toHaveBeenCalledWith('org_1', 'flag', undefined);
  });

  it('resolveFlag(provider) honors a definitive true', async () => {
    const provider = postHogFlagProvider({
      getFeatureFlag: vi.fn().mockResolvedValue(true),
    });
    await expect(
      resolveFlag(provider, 'flag', { unitId: 'org_1' })
    ).resolves.toBe(true);
  });

  it('resolveFlag(provider) degrades to the safe default when PostHog errors', async () => {
    const provider = postHogFlagProvider({
      getFeatureFlag: vi.fn().mockRejectedValue(new Error('boom')),
    });
    // adapter returns undefined → resolveKillSwitch → default-off
    await expect(
      resolveFlag(provider, 'flag', { unitId: 'org_1' })
    ).resolves.toBe(false);
    // ...and respects an inverted safe default.
    await expect(
      resolveFlag(
        provider,
        'flag',
        { unitId: 'org_1' },
        { defaultEnabled: true }
      )
    ).resolves.toBe(true);
  });
});
