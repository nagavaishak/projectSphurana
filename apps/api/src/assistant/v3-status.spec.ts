import { isClaireV3EnabledForOrg } from './v3-status.js';

describe('isClaireV3EnabledForOrg', () => {
  it('always returns true (v3 generally available, gating removed 2026-04-26)', () => {
    expect(isClaireV3EnabledForOrg('org_abc')).toBe(true);
    expect(isClaireV3EnabledForOrg('org_xyz')).toBe(true);
    expect(isClaireV3EnabledForOrg('')).toBe(true);
  });
});
