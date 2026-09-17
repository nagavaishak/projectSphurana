import type { PractitionerLocation } from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  useAssignPractitionerLocations,
  useListPractitioners,
} from '@/features/practitioners';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';

import { useSetWeeklyShifts } from '../api';

interface TeamMemberMenuProps {
  practitionerId: string;
  practitionerName: string;
  /**
   * The member's location assignments. When present and non-empty, an
   * "Unassign from location" action is offered. Optional — omit on surfaces
   * that don't have the relation loaded.
   */
  locations?: PractitionerLocation[];
  /** The clickable trigger (avatar/name block, a button, etc.). */
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
}

/**
 * Popover menu for a team member on the scheduling surfaces (Scheduled shifts,
 * Timesheets). Mirrors Fresha's row menu: a "Schedule" section (set repeating
 * shifts, unassign from location, delete all shifts) and a "Team member"
 * section (view / edit).
 */
export function TeamMemberMenu({
  practitionerId,
  practitionerName,
  locations,
  children,
  align = 'start',
}: TeamMemberMenuProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const [open, setOpen] = useState(false);

  const [confirmDeleteShifts, setConfirmDeleteShifts] = useState(false);
  const [confirmUnassign, setConfirmUnassign] = useState(false);

  const { setWeeklyShifts, isSaving } = useSetWeeklyShifts();
  const { assignLocations, isAssigning } = useAssignPractitionerLocations();
  const { refetch: refetchPractitioners } = useListPractitioners({});

  const hasLocations = (locations?.length ?? 0) > 0;

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const handleSetRepeating = () =>
    navigate({
      to: '/team/repeating-shifts/$practitionerId',
      params: { practitionerId },
    });

  const handleDeleteAllShifts = () => setConfirmDeleteShifts(true);

  const handleUnassign = () => setConfirmUnassign(true);

  const goToMembers = () => navigate({ to: routes.teamMembers });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent align={align} className="w-60 p-1">
          <p className="px-3 pb-1 pt-2 text-sm font-semibold">Schedule</p>
          <MenuItem onClick={run(handleSetRepeating)}>
            Set repeating shifts
          </MenuItem>
          {hasLocations && (
            <MenuItem onClick={run(handleUnassign)}>
              Unassign from location
            </MenuItem>
          )}
          <MenuItem onClick={run(handleDeleteAllShifts)} destructive>
            Delete all shifts
          </MenuItem>

          <Separator className="my-1" />

          <p className="px-3 pb-1 pt-2 text-sm font-semibold">Team member</p>
          <MenuItem onClick={run(goToMembers)}>View team member</MenuItem>
          <MenuItem onClick={run(goToMembers)}>Edit team member</MenuItem>
        </PopoverContent>
      </Popover>

      <ConfirmDeleteDialog
        confirmLabel="Delete all shifts"
        description="Every repeating shift on this member's weekly schedule is removed. Day-specific overrides are kept."
        isPending={isSaving}
        onConfirm={() => setWeeklyShifts({ practitionerId, days: [] })}
        onOpenChange={setConfirmDeleteShifts}
        open={confirmDeleteShifts}
        title={<>Delete all repeating shifts for {practitionerName}?</>}
      />

      <ConfirmDeleteDialog
        confirmLabel="Unassign"
        description="They will no longer be bookable at those locations. Their shifts and past bookings are kept."
        isPending={isAssigning}
        onConfirm={() =>
          assignLocations(
            { practitionerId, locationIds: [] },
            { onSuccess: () => refetchPractitioners() }
          )
        }
        onOpenChange={setConfirmUnassign}
        open={confirmUnassign}
        title={<>Unassign {practitionerName} from their location(s)?</>}
      />
    </>
  );
}

function MenuItem({
  onClick,
  children,
  destructive,
}: {
  onClick: () => void;
  children: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors',
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'hover:bg-muted'
      )}
    >
      {children}
    </button>
  );
}
