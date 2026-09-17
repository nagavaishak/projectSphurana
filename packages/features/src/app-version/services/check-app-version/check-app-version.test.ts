import { describe, expect, it } from '@borradh-workspace/testing';

import { ErrorCodes } from '../../../shared/index.js';

import {
  checkAppVersion,
  compareVersions,
} from './check-app-version.service.js';

const policy = {
  minimumVersion: '1.0.4',
  latestVersion: '1.2.0',
  storeUrl: 'https://apps.apple.com/app/id6759301177',
};

describe('compareVersions', () => {
  it('orders by numeric component, not lexically', () => {
    // The bug this guards: '1.0.10' < '1.0.9' as strings.
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
  });

  it('treats missing trailing components as zero', () => {
    expect(compareVersions('1.1', '1.1.0')).toBe(0);
    expect(compareVersions('2', '2.0.0')).toBe(0);
  });

  it('detects older and newer', () => {
    expect(compareVersions('1.0.3', '1.0.4')).toBeLessThan(0);
    expect(compareVersions('1.0.5', '1.0.4')).toBeGreaterThan(0);
  });
});

describe('checkAppVersion', () => {
  it('blocks a build below the minimum', async () => {
    const result = await checkAppVersion(
      { platform: 'ios', version: '1.0.3' },
      policy
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('update_required');
      expect(result.data.storeUrl).toBe(policy.storeUrl);
    }
  });

  it('allows the minimum version itself', async () => {
    // Off-by-one here locks out the exact build we just declared supported.
    const result = await checkAppVersion(
      { platform: 'ios', version: '1.0.4' },
      policy
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('update_available');
  });

  it('nudges a supported but outdated build', async () => {
    const result = await checkAppVersion(
      { platform: 'android', version: '1.1.0' },
      policy
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('update_available');
  });

  it('is ok on the latest version', async () => {
    const result = await checkAppVersion(
      { platform: 'android', version: '1.2.0' },
      policy
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('ok');
  });

  it('is ok on a build newer than the store (TestFlight / internal)', async () => {
    const result = await checkAppVersion(
      { platform: 'ios', version: '1.3.0' },
      policy
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('ok');
  });

  it('fails open when no policy is configured', async () => {
    // The whole install base rides on this branch: an unset env var must not
    // block anyone.
    const result = await checkAppVersion(
      { platform: 'ios', version: '0.0.1' },
      {}
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('ok');
      expect(result.data.minimumVersion).toBeNull();
    }
  });

  it('fails open when only latestVersion is configured', async () => {
    const result = await checkAppVersion(
      { platform: 'ios', version: '0.0.1' },
      { latestVersion: '1.2.0' }
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('update_available');
  });

  it('returns VALIDATION_ERROR for an unknown platform', async () => {
    const result = await checkAppVersion(
      { platform: 'web' as never, version: '1.0.4' },
      policy
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for a non-numeric version', async () => {
    const result = await checkAppVersion(
      { platform: 'ios', version: '1.0.4-beta' },
      policy
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
