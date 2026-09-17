import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  addDays,
  addWeeks,
  endOfWeek,
  format,
  isSameDay,
  startOfWeek,
  subWeeks,
} from 'date-fns';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Loader2,
  Plus,
  Printer,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { PageShell } from '@/components/app/page-shell';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useListPractitioners } from '@/features/practitioners';
import {
  type ResolvedShiftDay,
  ShiftOverrideDialog,
  TeamMemberMenu,
  TimeOffDialog,
  formatHoursLabel,
  formatMinutesLabel,
  useDeleteShiftOverride,
  useListShifts,
  useSetShiftOverride,
} from '@/features/scheduling';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { TeamShiftsMobile } from './-components/team-shifts-mobile';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/team/shifts'
)({
  component: ShiftsRoute,
});

function ShiftsRoute() {
  const isMobile = useIsMobile();
  if (isMobile) return <TeamShiftsMobile />;
  return <ShiftsPage />;
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Total worked minutes across a resolved day's intervals. */
function dayMinutes(resolved: ResolvedShiftDay | null): number {
  if (!resolved || resolved.isOff) return 0;
  return resolved.intervals.reduce(
    (sum, i) => sum + (i.endMinutes - i.startMinutes),
    0
  );
}

interface OverrideTarget {
  practitionerId: string;
  practitionerName: string;
  date: string;
  resolvedDay: ResolvedShiftDay | null;
}

function ShiftsPage() {
  const navigate = useNavigate();
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [overrideTarget, setOverrideTarget] = useState<OverrideTarget | null>(
    null
  );
  const [timeOffOpen, setTimeOffOpen] = useState(false);

  const weekStart = useMemo(() => startOfWeek(weekAnchor), [weekAnchor]);
  const weekEnd = useMemo(() => endOfWeek(weekAnchor), [weekAnchor]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const isCurrentWeek = useMemo(
    () => isSameDay(weekStart, startOfWeek(new Date())),
    [weekStart]
  );

  const { practitioners, isLoading: isPractitionersLoading } =
    useListPractitioners({ params: { isActive: true } });

  const { shiftDays, isLoading: isShiftsLoading } = useListShifts({
    from: weekStart.toISOString(),
    to: weekEnd.toISOString(),
  });

  const { setShiftOverride } = useSetShiftOverride();
  const { deleteShiftOverride } = useDeleteShiftOverride();

  // Lookup: `${practitionerId}|${yyyy-MM-dd}` -> resolved day.
  const shiftLookup = useMemo(() => {
    const map = new Map<string, ResolvedShiftDay>();
    for (const day of shiftDays) {
      map.set(`${day.practitionerId}|${day.date}`, day);
    }
    return map;
  }, [shiftDays]);

  const resolvedFor = (
    practitionerId: string,
    date: Date
  ): ResolvedShiftDay | null =>
    shiftLookup.get(`${practitionerId}|${format(date, 'yyyy-MM-dd')}`) ?? null;

  // Total worked minutes per day across all practitioners (column subtotal).
  const dayTotals = weekDays.map((date) =>
    practitioners.reduce(
      (sum, p) => sum + dayMinutes(resolvedFor(p.id, date)),
      0
    )
  );

  const weeklyMinutesFor = (practitionerId: string): number =>
    weekDays.reduce(
      (sum, date) => sum + dayMinutes(resolvedFor(practitionerId, date)),
      0
    );

  const openOverride = (
    practitionerId: string,
    practitionerName: string,
    date: Date,
    resolved: ResolvedShiftDay | null
  ) =>
    setOverrideTarget({
      practitionerId,
      practitionerName,
      date: format(date, 'yyyy-MM-dd'),
      resolvedDay: resolved,
    });

  const openRepeating = (practitionerId: string) =>
    navigate({
      to: '/team/repeating-shifts/$practitionerId',
      params: { practitionerId },
    });

  const deleteShift = (
    practitionerId: string,
    date: Date,
    resolved: ResolvedShiftDay | null
  ) => {
    const iso = format(date, 'yyyy-MM-dd');
    if (resolved?.source === 'override') {
      // A weekly day marked off as an override -> drop the override entirely;
      // otherwise the override cleared the shift for this date already.
      deleteShiftOverride({ practitionerId, date: iso });
      return;
    }
    // Turn off a standing weekly day for this date only.
    setShiftOverride({ practitionerId, date: iso, isOff: true, intervals: [] });
  };

  const isLoading = isPractitionersLoading || isShiftsLoading;

  return (
    <>
      <title>Shifts | Borradh</title>
      <PageShell>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Scheduled shifts</h1>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-1.5 rounded-full">
                  Options
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => window.print()}>
                  <Printer className="size-4" />
                  Print roster
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="gap-1.5 rounded-full">
                  Add
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTimeOffOpen(true)}>
                  Time off
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 p-3">
          <Button
            variant="outline"
            className="gap-1.5 rounded-full bg-background"
          >
            Custom order
            <ArrowUpDown className="size-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className={cn(
                'rounded-full bg-background',
                isCurrentWeek && 'font-medium'
              )}
              onClick={() => setWeekAnchor(new Date())}
            >
              This week
            </Button>
            <div className="flex items-center rounded-full border bg-background">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous week"
                className="rounded-full"
                onClick={() => setWeekAnchor((d) => subWeeks(d, 1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2 text-sm font-medium tabular-nums">
                {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next week"
                className="rounded-full"
                onClick={() => setWeekAnchor((d) => addWeeks(d, 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : practitioners.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>No team members yet</EmptyTitle>
              <EmptyDescription>
                Add team members to plan their shifts.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              {/* Column header */}
              <div className="grid grid-cols-[300px_repeat(7,minmax(0,1fr))] items-end border-b pb-3">
                <div className="px-1 text-sm">
                  <span className="font-medium">Team member </span>
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                  >
                    Change
                  </button>
                </div>
                {weekDays.map((day, i) => {
                  const isToday = isSameDay(day, new Date());
                  return (
                    <div key={day.toISOString()} className="px-2 text-center">
                      <div
                        className={cn(
                          'text-sm font-semibold',
                          isToday ? 'text-primary' : 'text-foreground'
                        )}
                      >
                        {format(day, 'EEE, MMM d')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatHoursLabel(dayTotals[i])}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Rows */}
              <div className="mt-3 overflow-hidden rounded-xl border">
                {practitioners.map((practitioner, rowIndex) => (
                  <div
                    key={practitioner.id}
                    className={cn(
                      'grid grid-cols-[300px_repeat(7,minmax(0,1fr))] items-stretch',
                      rowIndex > 0 && 'border-t'
                    )}
                  >
                    <div className="border-r">
                      <TeamMemberMenu
                        practitionerId={practitioner.id}
                        practitionerName={practitioner.name}
                        locations={practitioner.locations}
                      >
                        <button
                          type="button"
                          className="flex h-full w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted"
                        >
                          <Avatar className="size-10 ring-2 ring-primary/20">
                            {practitioner.photo && (
                              <AvatarImage
                                src={practitioner.photo}
                                alt={practitioner.name}
                              />
                            )}
                            <AvatarFallback className="text-xs">
                              {initials(practitioner.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-medium">
                              {practitioner.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatHoursLabel(
                                weeklyMinutesFor(practitioner.id)
                              )}
                            </span>
                          </div>
                        </button>
                      </TeamMemberMenu>
                    </div>

                    {weekDays.map((day) => {
                      const resolved = resolvedFor(practitioner.id, day);
                      return (
                        <ShiftCell
                          key={day.toISOString()}
                          resolved={resolved}
                          onEditDay={() =>
                            openOverride(
                              practitioner.id,
                              practitioner.name,
                              day,
                              resolved
                            )
                          }
                          onSetRepeating={() => openRepeating(practitioner.id)}
                          onAddTimeOff={() => setTimeOffOpen(true)}
                          onDelete={() =>
                            deleteShift(practitioner.id, day, resolved)
                          }
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-start gap-3 rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">
          <Lightbulb className="mt-0.5 size-5 shrink-0" />
          <p>
            The team roster shows your availability for bookings and is not
            linked to your business standard opening hours. To set your standard
            opening hours,{' '}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => navigate({ to: '/dashboard/settings/details' })}
            >
              click here.
            </button>
          </p>
        </div>
      </PageShell>

      {overrideTarget && (
        <ShiftOverrideDialog
          open
          onOpenChange={(open) => {
            if (!open) setOverrideTarget(null);
          }}
          practitionerId={overrideTarget.practitionerId}
          practitionerName={overrideTarget.practitionerName}
          date={overrideTarget.date}
          resolvedDay={overrideTarget.resolvedDay}
        />
      )}

      <TimeOffDialog open={timeOffOpen} onOpenChange={setTimeOffOpen} />
    </>
  );
}

function ShiftCell({
  resolved,
  onEditDay,
  onSetRepeating,
  onAddTimeOff,
  onDelete,
}: {
  resolved: ResolvedShiftDay | null;
  onEditDay: () => void;
  onSetRepeating: () => void;
  onAddTimeOff: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isOff = !resolved || resolved.isOff || resolved.intervals.length === 0;

  // Not working: single click opens the day editor to add a shift.
  if (isOff) {
    return (
      <div className="border-l p-2">
        <button
          type="button"
          onClick={onEditDay}
          className="flex h-full min-h-[56px] w-full items-center justify-center rounded-lg bg-muted/40 text-sm text-muted-foreground transition-colors hover:bg-muted"
        >
          Not working
        </button>
      </div>
    );
  }

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="group relative border-l p-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex min-h-[56px] w-full flex-col justify-center gap-1 rounded-lg bg-primary/10 px-2 py-1.5 text-center text-sm text-foreground transition-colors hover:bg-primary/20 data-[state=open]:bg-primary/25"
          >
            {resolved.intervals.map((interval, index) => (
              <span key={index} className="font-medium">
                {formatMinutesLabel(interval.startMinutes)} –{' '}
                {formatMinutesLabel(interval.endMinutes)}
              </span>
            ))}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-52 p-1">
          <button
            type="button"
            onClick={run(onEditDay)}
            className="flex w-full items-center rounded-md px-3 py-2 text-sm hover:bg-muted"
          >
            Edit this day
          </button>
          <button
            type="button"
            onClick={run(onSetRepeating)}
            className="flex w-full items-center rounded-md px-3 py-2 text-sm hover:bg-muted"
          >
            Set repeating shifts
          </button>
          <button
            type="button"
            onClick={run(onAddTimeOff)}
            className="flex w-full items-center rounded-md px-3 py-2 text-sm hover:bg-muted"
          >
            Add time off
          </button>
          <button
            type="button"
            onClick={run(onDelete)}
            className="flex w-full items-center rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
          >
            Delete this shift
          </button>
        </PopoverContent>
      </Popover>

      {/* Add another shift for this day (revealed on hover). */}
      <button
        type="button"
        aria-label="Add another shift"
        onClick={onEditDay}
        className="mt-1 flex w-full items-center justify-center rounded-lg bg-primary/10 py-1 text-primary opacity-0 transition-opacity hover:bg-primary/20 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
