import type { PractitionerWithRelations } from '@borradh-workspace/api-client/types';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { MoreVertical, Users } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useActiveLocation } from '@/features/organization-locations';
import {
  useDeletePractitioner,
  useInvitePractitioner,
  useListPractitioners,
} from '@/features/practitioners';
import { ImportTeamMembersDialog } from '@/features/practitioners/import-team-members-dialog';

import {
  MemberRoleBadge,
  useOrgRolesByUserId,
} from './-components/member-role';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/team/members'
)({
  component: PractitionersPage,
});

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Team roster, on the shared `ListPage`.
 *
 * There is no `useIsMobile` branch and no `TeamMembersMobile` any more: the
 * desktop table and the phone list render from the SAME column config. The
 * TanStack `useReactTable` instance went with it — the shell renders rows
 * directly, so the only thing it was still doing was the name filter, which now
 * lives in `rows` below.
 */
function PractitionersPage() {
  const { practitioners, isLoading, isError, error } = useListPractitioners({});
  const { isMultiLocation } = useActiveLocation();
  const [importOpen, setImportOpen] = useState(false);
  const { deletePractitioner, isDeleting } = useDeletePractitioner();
  const { invitePractitioner, isInviting } = useInvitePractitioner();
  const rolesByUserId = useOrgRolesByUserId();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] =
    useState<PractitionerWithRelations | null>(null);

  // Add/edit are the SHARED editor route now (`/create/team-member`,
  // `/edit/team-member/:id`); the full-screen portal editor is gone.
  const openAdd = () =>
    void navigate({ params: { entity: 'team-member' }, to: '/create/$entity' });

  const openEdit = useCallback(
    (practitioner: PractitionerWithRelations) =>
      void navigate({
        params: { entity: 'team-member', id: practitioner.id },
        to: '/edit/$entity/$id',
      }),
    [navigate]
  );

  const handleDelete = useCallback(
    (practitioner: PractitionerWithRelations) => setDeleteTarget(practitioner),
    []
  );

  // Filtering stays HERE, not in the shell: this roster matches on name OR
  // email, which is its own notion of "matches".
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const sorted = [...practitioners].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    if (!term) return sorted;
    return sorted.filter(
      (practitioner) =>
        practitioner.name.toLowerCase().includes(term) ||
        (practitioner.email ?? '').toLowerCase().includes(term)
    );
  }, [practitioners, search]);

  const columns: ListColumn<PractitionerWithRelations>[] = [
    {
      id: 'avatar',
      mobile: 'media',
      width: 'w-12',
      cell: (practitioner) => (
        <Avatar className="size-8">
          {practitioner.photo && (
            <AvatarImage alt={practitioner.name} src={practitioner.photo} />
          )}
          <AvatarFallback className="text-xs">
            {getInitials(practitioner.name)}
          </AvatarFallback>
        </Avatar>
      ),
    },
    {
      id: 'name',
      header: 'Name',
      mobile: 'primary',
      cell: (practitioner) => (
        <div className="flex flex-col">
          <span className="font-medium">{practitioner.name}</span>
          {practitioner.title && (
            <span className="text-muted-foreground text-xs">
              {practitioner.title}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'email',
      header: 'Email',
      mobile: 'secondary',
      cell: (practitioner) => (
        <span className="text-muted-foreground">{practitioner.email}</span>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      cell: (practitioner) => (
        <MemberRoleBadge
          role={
            practitioner.userId
              ? rolesByUserId.get(practitioner.userId)
              : undefined
          }
        />
      ),
    },
    {
      id: 'status',
      header: 'Status',
      mobile: 'trailing',
      cell: (practitioner) => {
        // "Invited" means an invitation is OUTSTANDING — not merely that there is no
        // linked user account (ENG-794). Those are different states and only one of
        // them is non-bookable: a practitioner the onboarding wizard added was never
        // emailed at all, has no `userId` either, and IS bookable. Reading `userId`
        // here labelled them "Invited" too, which is exactly the conflation that let
        // real invitees pass for working staff.
        if (practitioner.invitationPending) {
          return <Badge variant="outline">Invited</Badge>;
        }
        return (
          <Badge variant={practitioner.isActive ? 'default' : 'secondary'}>
            {practitioner.isActive ? 'Active' : 'Inactive'}
          </Badge>
        );
      },
    },
  ];

  return (
    <>
      {/*
        Matches the page's own heading (`title: 'Team members'` below) and the
        sidebar entry. It read "Practitioners" — the pre-rename label, which the
        product no longer uses anywhere a user can see — so the browser tab and
        history entry named a surface that does not exist by that name. Its
        sibling `shifts.tsx` already titles itself after its heading.
      */}
      <title>Team members | Borradh</title>

      <ListPage<PractitionerWithRelations>
        config={{
          title: 'Team members',
          columns,
          rows,
          rowKey: (practitioner) => practitioner.id,
          // E2E fixtures address rows by this id on BOTH viewports; the deleted
          // hand-written mobile list emitted it and the shared list must too.
          rowTestId: (practitioner) => `team-member-row-${practitioner.id}`,
          onRowClick: openEdit,
          rowActions: (practitioner) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="size-7" size="icon" variant="ghost">
                  <span className="sr-only">Open menu</span>
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(practitioner)}>
                  Edit
                </DropdownMenuItem>
                {/*
                  Offered only while the member has no account yet — i.e. exactly
                  while the row reads "Invited". Members added by the onboarding
                  wizard were never emailed at all, and one whose invite was lost
                  previously had no way to get another.
                */}
                {!practitioner.userId && (
                  <DropdownMenuItem
                    disabled={isInviting}
                    onClick={() => invitePractitioner({ id: practitioner.id })}
                  >
                    Send invitation
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => handleDelete(practitioner)}
                  variant="destructive"
                >
                  Deactivate
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
          searchPlaceholder: 'Search team members',
          search,
          onSearchChange: setSearch,
          primaryAction: {
            label: 'Add team member',
            mobileLabel: 'Add',
            onClick: openAdd,
            // Only where there is another branch to draw from. A new branch
            // usually staffs itself from people the business already employs,
            // and the alternative is inviting a colleague who already has an
            // account — which creates a duplicate, not a second branch.
            menu: isMultiLocation
              ? {
                  items: [
                    { label: 'New team member', onSelect: openAdd },
                    {
                      label: 'Add from another location…',
                      onSelect: () => setImportOpen(true),
                    },
                  ],
                }
              : undefined,
          },
          isLoading,
          isError,
          errorMessage: `Failed to load practitioners: ${error?.message || 'Unknown error'}`,
          empty: {
            icon: Users,
            title: search ? 'No matches' : 'No team members yet',
            description: search
              ? 'No team members match your search.'
              : 'Add your first team member to get started.',
          },
        }}
      />

      <ImportTeamMembersDialog onOpenChange={setImportOpen} open={importOpen} />

      <ConfirmDeleteDialog
        confirmLabel="Deactivate"
        description="They are deactivated rather than erased, so their past bookings and sales keep working. They will no longer be bookable or able to sign in."
        isPending={isDeleting}
        onConfirm={() => {
          if (deleteTarget) deletePractitioner(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
        title={<>Deactivate {deleteTarget?.name}?</>}
      />
    </>
  );
}
