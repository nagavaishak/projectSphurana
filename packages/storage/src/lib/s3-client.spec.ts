import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromNodeProviderChain = vi.fn();

vi.mock('@aws-sdk/credential-providers', () => ({ fromNodeProviderChain }));
vi.mock('@borradh-workspace/env/storage', () => ({
  storageEnv: {
    S3_REGION: 'eu-west-1',
    AWS_PROFILE: 'borradh-staging',
    S3_PUBLIC_ASSETS_BUCKET: 'public-assets',
    S3_ORG_ASSETS_BUCKET: 'org-assets',
    S3_FORCE_PATH_STYLE: false,
  },
}));

const CREDENTIALS = {
  accessKeyId: 'AKIA',
  secretAccessKey: 'secret',
};

/** Fresh module state per test — the chain is a module-level singleton. */
const loadResolver = async () => {
  vi.resetModules();
  const mod = await import('./s3-client.js');
  return mod.resolveCredentials;
};

describe('resolveCredentials', () => {
  beforeEach(() => {
    fromNodeProviderChain.mockReset();
  });

  /**
   * The regression this file exists for.
   *
   * `memoizeChain` in `@aws-sdk/credential-provider-node` clears its
   * `activeLock` only from the success callback, so a rejected resolution
   * stays latched and every later call re-throws it — for the life of the
   * process, even once the credentials are repaired. That is what made one
   * lapsed `aws sso login` break every direct-to-S3 upload until the dev
   * server was restarted. The chain below models that latch exactly.
   */
  it('rebuilds a chain that latched a failure, so repaired credentials recover', async () => {
    const latched = vi
      .fn()
      .mockRejectedValue(new Error('The SSO session has expired'));
    const healthy = vi.fn().mockResolvedValue(CREDENTIALS);
    fromNodeProviderChain
      .mockReturnValueOnce(latched)
      .mockReturnValueOnce(healthy);

    const resolveCredentials = await loadResolver();

    await expect(resolveCredentials()).rejects.toThrow('SSO session');
    // The credential source is repaired out-of-band (`aws sso login`); the
    // very next call must succeed WITHOUT a process restart.
    await expect(resolveCredentials()).resolves.toEqual(CREDENTIALS);
    expect(fromNodeProviderChain).toHaveBeenCalledTimes(2);
  });

  it('keeps failing while the credential source is still broken', async () => {
    const broken = vi.fn().mockRejectedValue(new Error('still expired'));
    fromNodeProviderChain.mockReturnValue(broken);

    const resolveCredentials = await loadResolver();

    await expect(resolveCredentials()).rejects.toThrow('still expired');
    await expect(resolveCredentials()).rejects.toThrow('still expired');
    // A rebuild per failed attempt — never a latched success, never silence.
    expect(fromNodeProviderChain).toHaveBeenCalledTimes(2);
  });

  /**
   * The reset must not cost us the caching it sits on top of: re-resolving
   * SSO on every request is exactly what the memoizing chain is there to
   * avoid.
   */
  it('reuses one chain while resolution keeps succeeding', async () => {
    const healthy = vi.fn().mockResolvedValue(CREDENTIALS);
    fromNodeProviderChain.mockReturnValue(healthy);

    const resolveCredentials = await loadResolver();

    await resolveCredentials();
    await resolveCredentials();
    await resolveCredentials();

    expect(fromNodeProviderChain).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(3);
  });

  it('passes caller properties through to the chain', async () => {
    const healthy = vi.fn().mockResolvedValue(CREDENTIALS);
    fromNodeProviderChain.mockReturnValue(healthy);

    const resolveCredentials = await loadResolver();
    await resolveCredentials({ forceRefresh: true });

    expect(healthy).toHaveBeenCalledWith({ forceRefresh: true });
  });
});
