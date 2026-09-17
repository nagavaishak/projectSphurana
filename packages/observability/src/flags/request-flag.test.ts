import { describe, expect, it } from 'vitest';
import { withObservabilityContext } from '../context.js';
import { type FlagProvider, staticProvider } from './provider.js';
import { isFeatureOn } from './request-flag.js';
import { withFlags } from './testing.js';

describe('isFeatureOn', () => {
  it('resolves a flag using the current request context', async () => {
    const result = await withObservabilityContext(
      { organizationId: 'org_1', userId: 'user_1' },
      () => isFeatureOn('my-flag', { provider: withFlags({ 'my-flag': true }) })
    );
    expect(result).toBe(true);
  });

  it('uses the org id as the rollout unit + group (org precedence over user)', async () => {
    let seen: { unitId?: string; groups?: Record<string, string> } | undefined;
    const recorder: FlagProvider = {
      getFlag(_key, context) {
        seen = context;
        return true;
      },
    };

    await withObservabilityContext(
      { organizationId: 'org_1', userId: 'user_1' },
      () => isFeatureOn('my-flag', { provider: recorder })
    );

    expect(seen?.unitId).toBe('org_1');
    expect(seen?.groups).toEqual({ organization: 'org_1' });
  });

  it('falls back to the user id when there is no org', async () => {
    let seen: { unitId?: string; groups?: Record<string, string> } | undefined;
    const recorder: FlagProvider = {
      getFlag(_key, context) {
        seen = context;
        return undefined;
      },
    };

    await withObservabilityContext({ userId: 'user_9' }, () =>
      isFeatureOn('my-flag', { provider: recorder })
    );

    expect(seen?.unitId).toBe('user_9');
    expect(seen?.groups).toBeUndefined();
  });

  it('defaults OFF for a no-opinion flag, honoring defaultEnabled', async () => {
    const off = await withObservabilityContext(
      { organizationId: 'org_1' },
      () => isFeatureOn('unknown', { provider: staticProvider({}) })
    );
    expect(off).toBe(false);

    const on = await withObservabilityContext({ organizationId: 'org_1' }, () =>
      isFeatureOn('unknown', {
        provider: staticProvider({}),
        defaultEnabled: true,
      })
    );
    expect(on).toBe(true);
  });

  it('degrades to the safe default when the provider throws', async () => {
    const throwing: FlagProvider = {
      getFlag() {
        throw new Error('posthog unreachable');
      },
    };
    const result = await withObservabilityContext(
      { organizationId: 'org_1' },
      () => isFeatureOn('my-flag', { provider: throwing })
    );
    expect(result).toBe(false);
  });

  it('does not throw outside a request context', async () => {
    const result = await isFeatureOn('my-flag', {
      provider: staticProvider({}),
    });
    expect(result).toBe(false);
  });
});
