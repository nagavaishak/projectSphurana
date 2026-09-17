/**
 * Pins the deliberate asymmetry between the two version gates.
 *
 * `latestVersion` falls back to the API's own build version so the update nudge
 * tracks releases on its own. `minimumVersion` must NOT: it BLOCKS the app, so
 * defaulting it to the deployed version would lock every user out on each
 * release until they updated. The two lines look parallel and invite being
 * "tidied" into symmetry — these tests are what should stop that.
 */
const mockEnv: Record<string, string | undefined> = {};
jest.mock('@borradh-workspace/env/api', () => ({
  get apiEnv() {
    return mockEnv;
  },
}));
jest.mock('@borradh-workspace/observability', () => ({
  getAppVersion: () => '1.0.4',
}));

const checkAppVersion = jest.fn();
jest.mock('@borradh-workspace/features/app-version', () => ({
  checkAppVersion: (...args: unknown[]) => checkAppVersion(...args),
}));
jest.mock('@borradh-workspace/features/shared', () => ({ ErrorCodes: {} }));
// ../common pulls the auth guard, which pulls @borradh-workspace/database and
// its ESM-only schema — none of which this test needs. Only @Public() is used.
jest.mock('../common/index.js', () => ({ Public: () => () => undefined }));

import { AppVersionController } from './app-version.controller.js';

const policyFor = async (platform: 'ios' | 'android') => {
  checkAppVersion.mockResolvedValue({ success: true, data: {} });
  await new AppVersionController().check({
    platform,
    version: '1.0.0',
  } as never);
  return checkAppVersion.mock.calls.at(-1)?.[1];
};

describe('AppVersionController version policy', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k];
    checkAppVersion.mockReset();
  });

  it.each(['ios', 'android'] as const)(
    'defaults latestVersion to the API build version on %s',
    async (platform) => {
      expect((await policyFor(platform)).latestVersion).toBe('1.0.4');
    }
  );

  it.each(['ios', 'android'] as const)(
    'leaves minimumVersion unset on %s — it must never gate on the deployed version',
    async (platform) => {
      expect((await policyFor(platform)).minimumVersion).toBeUndefined();
    }
  );

  it('lets an explicit env value win over the fallback', async () => {
    mockEnv.MOBILE_LATEST_VERSION_IOS = '2.0.0';
    expect((await policyFor('ios')).latestVersion).toBe('2.0.0');
  });

  it('keeps the two platforms independent', async () => {
    mockEnv.MOBILE_LATEST_VERSION_IOS = '2.0.0';
    expect((await policyFor('android')).latestVersion).toBe('1.0.4');
  });
});
