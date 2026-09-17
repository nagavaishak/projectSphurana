import { useNavigate } from '@tanstack/react-router';
import { endOfDay, format, isToday, startOfDay } from 'date-fns';
import {
  CalendarOff,
  CalendarRange,
  Clock,
  Columns3,
  Grid2x2,
  Pencil,
  Plane,
  Plus,
  Square,
  User,
} from 'lucide-react';
import { useState } from 'react';

import { useCalendar } from '@/components/calendar';
import type { IUser } from '@/components/calendar';
import {
  SWITCHABLE_VIEWS,
  type TSwitchableView,
  VIEW_LABELS,
  VIEW_ROUTE_SLUGS,
} from '@/components/calendar/components/header/view-routes';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { useListLocations } from '@/features/organization-locations';
import {
  BlockedTimeDialog,
  ShiftOverrideDialog,
  TimeOffDialog,
  useListShifts,
} from '@/features/scheduling';
import {
  useClockIn,
  useClockOut,
  useListTimeEntries,
} from '@/features/timesheets';
import { useBranchRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';

type DialogKind = 'appointment' | 'blocked' | 'shift' | 'timeoff' | null;

const VIEW_ICONS: Record<TSwitchableView, typeof Square> = {
  day: Square,
  '3day': Columns3,
  week: CalendarRange,
  month: Grid2x2,
};

function fmtMinutes(minutesSinceMidnight: number): string {
  const h = Math.floor(minutesSinceMidnight / 60);
  const m = minutesSinceMidnight % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fmtDelta(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

/**
 * Popover menu for a staff column header in the day view. Shows the member's
 * scheduled shift + a clock-in/out control, per-person view switches (which
 * scope the calendar to just this member), and quick actions. All feature
 * hooks key on the practitioner id (`staff.id`).
 */
export function StaffHeaderMenu({
  staff,
  children,
}: {
  staff: IUser;
  children: React.ReactNode;
}) {
  const { config, selectedDate, setSelectedUserIds } = useCalendar();
  const navigate = useNavigate();
  const routes = useBranchRoutes();
  const routerBasePath = config.routerBasePath ?? '';

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };

  const active = popoverOpen || dialog !== null;
  const dayKey = format(selectedDate, 'yyyy-MM-dd');
  const dayStart = startOfDay(selectedDate);
  const dayEnd = endOfDay(selectedDate);

  // Shift + timesheet data — only fetched while the popover/dialog is open.
  const { shiftDays } = useListShifts(
    active
      ? {
          from: dayStart.toISOString(),
          to: dayEnd.toISOString(),
          practitionerId: staff.id,
        }
      : { from: '', to: '' }
  );
  const resolvedDay = shiftDays.find((d) => d.date === dayKey) ?? null;

  const { timeEntries } = useListTimeEntries(
    active
      ? { from: dayStart, to: dayEnd, practitionerId: staff.id }
      : undefined,
    { enabled: active }
  );
  const openEntry = timeEntries.find((e) => e.clockOut === null) ?? null;

  const { locations } = useListLocations();
  const { clockIn, isClockingIn } = useClockIn();
  const { clockOut, isClockingOut } = useClockOut();

  const interval =
    resolvedDay && !resolvedDay.isOff ? resolvedDay.intervals[0] : undefined;
  const lastInterval = resolvedDay?.intervals.at(-1);
  const locationName = interval?.locationId
    ? (locations.find((l) => l.id === interval.locationId)?.name ?? null)
    : null;

  const shiftSubtitle =
    interval && lastInterval
      ? `${fmtMinutes(interval.startMinutes)} to ${fmtMinutes(lastInterval.endMinutes)}${
          locationName ? ` at ${locationName}` : ''
        }`
      : null;

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isTodaySelected = isToday(selectedDate);

  let statusTitle = 'No scheduled shift';
  if (openEntry) statusTitle = 'Clocked in';
  else if (interval) {
    const lateBy = nowMinutes - interval.startMinutes;
    statusTitle =
      isTodaySelected && lateBy > 0
        ? `${fmtDelta(lateBy)} late for scheduled shift`
        : 'Scheduled shift';
  }

  const handleView = (view: TSwitchableView) => {
    setSelectedUserIds([staff.id]);
    setPopoverOpen(false);
    navigate({ to: `${routerBasePath}/${VIEW_ROUTE_SLUGS[view]}` as never });
  };

  const openAction = (kind: Exclude<DialogKind, null>) => {
    setPopoverOpen(false);
    setDialog(kind);
  };

  const AddAppointmentDialog = config.customAddDialog;

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="center">
          {/* Shift status + clock in/out */}
          <div className="space-y-3 p-4">
            <div>
              <p className="text-base font-semibold leading-snug">
                {statusTitle}
              </p>
              {shiftSubtitle && (
                <p className="text-sm text-muted-foreground">{shiftSubtitle}</p>
              )}
            </div>
            {isTodaySelected && interval && (
              <Button
                size="lg"
                className="w-fit"
                disabled={isClockingIn || isClockingOut}
                onClick={() => {
                  if (openEntry) clockOut({ id: openEntry.id });
                  else clockIn({ practitionerId: staff.id });
                }}
              >
                <Clock className="size-4" />
                {openEntry ? 'Clock out' : 'Clock in'}
              </Button>
            )}
          </div>

          <Separator />

          {/* Per-person view switches */}
          <div className="p-2">
            {SWITCHABLE_VIEWS.map((view) => {
              const Icon = VIEW_ICONS[view];
              return (
                <MenuButton
                  key={view}
                  icon={<Icon />}
                  onClick={() => handleView(view)}
                >
                  {VIEW_LABELS[view]} view
                </MenuButton>
              );
            })}
          </div>

          <Separator />

          {/* Actions */}
          <div className="p-2">
            <p className="px-3 py-2 text-base font-semibold">Actions</p>
            {AddAppointmentDialog && (
              <MenuButton
                icon={<Plus />}
                onClick={() => openAction('appointment')}
              >
                Add appointment
              </MenuButton>
            )}
            <MenuButton
              icon={<CalendarOff />}
              onClick={() => openAction('blocked')}
            >
              Add blocked time
            </MenuButton>
            <MenuButton icon={<Pencil />} onClick={() => openAction('shift')}>
              Edit shift
            </MenuButton>
            <MenuButton icon={<Plane />} onClick={() => openAction('timeoff')}>
              Add time off
            </MenuButton>
            <MenuButton
              icon={<User />}
              onClick={() => {
                setPopoverOpen(false);
                navigate({ to: routes.teamMembers });
              }}
            >
              View team member
            </MenuButton>
          </div>
        </PopoverContent>
      </Popover>

      {AddAppointmentDialog && (
        <AddAppointmentDialog
          open={dialog === 'appointment'}
          onOpenChange={closeDialog}
          startDate={selectedDate}
          practitionerId={staff.id}
        />
      )}

      <BlockedTimeDialog
        open={dialog === 'blocked'}
        onOpenChange={closeDialog}
        initial={{ practitionerId: staff.id, startDate: selectedDate }}
      />

      <ShiftOverrideDialog
        open={dialog === 'shift'}
        onOpenChange={closeDialog}
        practitionerId={staff.id}
        practitionerName={staff.name}
        date={dayKey}
        resolvedDay={resolvedDay}
      />

      <TimeOffDialog
        open={dialog === 'timeoff'}
        onOpenChange={closeDialog}
        initial={{ practitionerId: staff.id, date: dayKey }}
      />
    </>
  );
}

function MenuButton({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-base',
        'transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
      )}
    >
      <span className="text-muted-foreground [&_svg]:size-5">{icon}</span>
      {children}
    </button>
  );
}
