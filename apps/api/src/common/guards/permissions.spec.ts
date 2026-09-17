import { type Role, hasMinimumRole, hasPermission } from './permissions.js';

/**
 * The role model is three tiers: member < admin < owner.
 * `manager` and `practitioner` were merged into `admin` and `member`.
 * These tests pin the hierarchy and the money/public boundary so a future
 * edit (e.g. re-promoting admin to owner-level, or an exact-match check
 * replacing the >= comparison) fails loudly.
 */
describe('role hierarchy (hasMinimumRole)', () => {
  it('owner satisfies every gate', () => {
    expect(hasMinimumRole('owner', 'owner')).toBe(true);
    expect(hasMinimumRole('owner', 'admin')).toBe(true);
    expect(hasMinimumRole('owner', 'member')).toBe(true);
  });

  it('admin satisfies admin + member gates, but NOT owner', () => {
    expect(hasMinimumRole('admin', 'admin')).toBe(true);
    expect(hasMinimumRole('admin', 'member')).toBe(true);
    // The regression guard for the admin demotion (was level 100 = owner):
    expect(hasMinimumRole('admin', 'owner')).toBe(false);
  });

  it('member satisfies only the member gate', () => {
    expect(hasMinimumRole('member', 'member')).toBe(true);
    expect(hasMinimumRole('member', 'admin')).toBe(false);
    expect(hasMinimumRole('member', 'owner')).toBe(false);
  });

  it('treats an unknown role as the lowest possible level', () => {
    expect(hasMinimumRole('ghost' as Role, 'member')).toBe(false);
  });
});

describe('permission checks (hasPermission)', () => {
  it('owner has the wildcard', () => {
    expect(hasPermission('owner', 'anything:at:all')).toBe(true);
  });

  it('admin has operational permissions but not the wildcard', () => {
    expect(hasPermission('admin', 'services:manage')).toBe(true);
    expect(hasPermission('admin', 'appointments:view_all')).toBe(true);
    expect(hasPermission('admin', 'billing:manage')).toBe(false);
  });

  it('member is limited to own-scope operational permissions', () => {
    expect(hasPermission('member', 'appointments:view_own')).toBe(true);
    expect(hasPermission('member', 'schedule:manage_own')).toBe(true);
    expect(hasPermission('member', 'services:manage')).toBe(false);
    expect(hasPermission('member', 'appointments:view_all')).toBe(false);
  });

  it('returns false for an unknown role', () => {
    expect(hasPermission('ghost' as Role, 'appointments:view_own')).toBe(false);
  });
});
