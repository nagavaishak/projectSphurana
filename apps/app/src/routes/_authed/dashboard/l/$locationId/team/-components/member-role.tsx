import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  useGetActiveOrganization,
  useGetOrganizationMembers,
} from '@/features/organization/api';

/** Display labels for the underlying Better Auth `member.role`. */
const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

/**
 * Map of `userId` → org role (`owner` / `admin` / `member`) for the active org.
 *
 * The team page lists `practitioner` records, which don't carry the org
 * permission role — that lives on the Better Auth `member` table. We join the
 * two by `userId` so the list can show who's the owner/admin. Practitioners with
 * no linked user (still-pending invites) simply won't appear in the map.
 */
export function useOrgRolesByUserId(): Map<string, string> {
  const { data: org } = useGetActiveOrganization();
  const { members } = useGetOrganizationMembers(org?.id ?? '');

  return useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.userId, member.role);
    }
    return map;
  }, [members]);
}

/** Badge for an org role; owner is emphasized, unknown/absent renders a dash. */
export function MemberRoleBadge({ role }: { role: string | undefined }) {
  if (!role) {
    return <span className="text-muted-foreground">—</span>;
  }
  const label = ROLE_LABELS[role] ?? role;
  const variant =
    role === 'owner' ? 'default' : role === 'admin' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{label}</Badge>;
}
