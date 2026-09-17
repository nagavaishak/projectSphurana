/**
 * Permission matrix and role hierarchy for organization-level access control.
 *
 * Roles are checked against the `member.role` column in the database.
 * Permissions are fine-grained capabilities assigned to each role.
 */

/**
 * Three-tier role model:
 * - owner  — full control, incl. destructive org-level actions (manage
 *            practitioners, billing, org settings).
 * - admin  — operational/marketing management: ads, social posts, offers,
 *            services, leads, the whole team's calendar. Cannot do owner-only
 *            actions.
 * - member — trusted staff (e.g. practitioners). Day-to-day operational work,
 *            but NOT the money/public-facing actions (ads, posts, offers).
 *
 * `manager` and `practitioner` were merged into `admin` and `member`
 * respectively — they were synonyms with no distinct behaviour.
 */
export const ROLE_PERMISSIONS = {
  owner: ['*'],
  admin: [
    'appointments:view_all',
    'appointments:manage',
    'booking_forms:manage',
    'leads:view',
    'leads:manage',
    'services:manage',
    'practitioners:view',
    'schedule:manage_own',
  ],
  member: [
    'leads:view',
    'leads:manage',
    'appointments:view_own',
    'appointments:manage',
    'schedule:manage_own',
  ],
} as const;

export type Role = keyof typeof ROLE_PERMISSIONS;
export type Permission = string;

const ROLE_HIERARCHY: Record<Role, number> = {
  owner: 100,
  admin: 50,
  member: 10,
};

/**
 * Check if a role has a specific permission.
 * Roles with '*' (wildcard) have all permissions.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return (
    (perms as readonly string[]).includes('*') ||
    (perms as readonly string[]).includes(permission)
  );
}

/**
 * Check if a user's role meets or exceeds the required role level.
 */
export function hasMinimumRole(userRole: Role, requiredRole: Role): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0);
}
