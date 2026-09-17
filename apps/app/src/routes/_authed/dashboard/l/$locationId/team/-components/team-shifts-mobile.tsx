import { MobilePageShell } from '@/components/app/mobile-page-shell';
import {
  addDays,
  endOfWeek,
  format,
  isSameDay,
  startOfWeek,
  subDays,
} from 'date-fns';
import { CalendarOff, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { MobileHeaderIconButton } from '@/features/mobile-dashboard-header';
import {
  MOBILE_FILTER_CHROME_CLASS,
  MobileRecordList,
  MobileRecordListEmpty,
  MobileRecordListError,
  MobileRecordListLabel,
  MobileRecordListSkeleton,
  MobileRecordRow,
  MobileSegmentedTabs,
} from '@/features/mobile-ui';
import { useListPractitioners } from '@/features/practitioners';
import {
  type ResolvedShiftDay,
  ShiftOverrideDialog,
  TimeOffDialog,
  formatHoursLabel,
  formatMinutesLabel,
  useListShifts,
} from '@/features/scheduling';

interface OverrideTarget {
  practitionerId: string;
  practitionerName: string;
  date: string;
  resolvedDay: ResolvedShiftDay | null;
}

/** Total worked minutes across a resolved day's intervals. */
function dayMinutes(resolved: ResolvedShiftDay | null): number {
  if (!resolved || resolved.isOff) return 0;
  return resolved.intervals.reduce(
    (sum, i) => sum + (i.endMinutes - i.startMinutes),
    0
  );
}

function shiftLabel(resolved: ResolvedShiftDay | null): string {
  if (!resolved || resolved.isOff || resolved.intervals.length === 0) {
    return 'Not working';
  }
  return resolved.intervals
    .map(
      (interval) =>
        `${formatMinutesLabel(interval.startMinutes)} – ${formatMinutesLabel(
          interval.endMinutes
        )}`
    )
    .join(', ');
}

/**
 * Phone view of the weekly shifts grid. The 8-column roster cannot shrink to
 * 375px, so mobile shows one day at a time: a weekday selector plus a list of
 * every team member's shifts for that day. Tapping a row opens the same
 * per-day shift editor the desktop grid uses.
 */
export function TeamShiftsMobile() {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [overrideTarget, setOverrideTarget] = useState<OverrideTarget | null>(
    null
  );
  const [timeOffOpen, setTimeOffOpen] = useState(false);

  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const weekEnd = useMemo(() => endOfWeek(selectedDate), [selectedDate]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const selectedKey = format(selectedDate, 'yyyy-MM-dd');
  const isToday = isSameDay(selectedDate, new Date());

  const {
    practitioners,
    isLoading: isPractitionersLoading,
    isError: isPractitionersError,
    error: practitionersError,
  } = useListPractitioners({ params: { isActive: true } });

  const {
    shiftDays,
    isLoading: isShiftsLoading,
    isError: isShiftsError,
  } = useListShifts({
    from: weekStart.toISOString(),
    to: weekEnd.toISOString(),
  });

  const isLoading = isPractitionersLoading || isShiftsLoading;
  const isError = isPractitionersError || isShiftsError;

  // Lookup: `${practitionerId}|${yyyy-MM-dd}` -> resolved day.
  const shiftLookup = useMemo(() => {
    const map = new Map<string, ResolvedShiftDay>();
    for (const day of shiftDays) {
      map.set(`${day.practitionerId}|${day.date}`, day);
    }
    return map;
  }, [shiftDays]);

  const resolvedFor = (practitionerId: string): ResolvedShiftDay | null =>
    shiftLookup.get(`${practitionerId}|${selectedKey}`) ?? null;

  const dayTotalMinutes = practitioners.reduce(
    (sum, practitioner) => sum + dayMinutes(resolvedFor(practitioner.id)),
    0
  );

  const dayTabs = useMemo(
    () =>
      weekDays.map((day) => ({
        value: format(day, 'yyyy-MM-dd'),
        label: format(day, 'EEEEE'),
        ariaLabel: format(day, 'EEEE d MMMM'),
      })),
    [weekDays]
  );

  return (
    <>
      <title>Shifts | Borradh</title>
      <MobilePageShell
        action={
          <MobileHeaderIconButton
            aria-label="Add time off"
            onClick={() => setTimeOffOpen(true)}
          >
            <CalendarOff className="size-5" />
          </MobileHeaderIconButton>
        }
        contentClassName="px-4 pb-4"
        title="Shifts"
      >
        {/* Day selector: step a day at a time, or jump within the week. */}
        <div
          className={`flex items-center justify-between gap-2 px-1 py-1 ${MOBILE_FILTER_CHROME_CLASS}`}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous day"
            className="rounded-full"
            onClick={() => setSelectedDate((d) => subDays(d, 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="truncate text-[14px] font-medium tabular-nums">
            {format(selectedDate, 'EEE, d MMM yyyy')}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next day"
            className="rounded-full"
            onClick={() => setSelectedDate((d) => addDays(d, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <MobileSegmentedTabs
            aria-label="Select day"
            tabs={dayTabs}
            value={selectedKey}
            onValueChange={(value) =>
              setSelectedDate(new Date(`${value}T12:00:00`))
            }
          />
          {!isToday && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-[10px]"
              onClick={() => setSelectedDate(new Date())}
            >
              Today
            </Button>
          )}
        </div>

        {isLoading ? (
          <MobileRecordListSkeleton />
        ) : isError ? (
          <MobileRecordListError
            message={`Failed to load shifts: ${
              practitionersError?.message || 'Unknown error'
            }`}
          />
        ) : practitioners.length === 0 ? (
          <MobileRecordListEmpty
            icon={Users}
            title="No team members yet"
            description="Add team members to plan their shifts."
          />
        ) : (
          <>
            <MobileRecordListLabel>
              {format(selectedDate, 'EEEE d MMM')} ·{' '}
              {formatHoursLabel(dayTotalMinutes)}
            </MobileRecordListLabel>
            <MobileRecordList>
              {practitioners.map((practitioner) => {
                const resolved = resolvedFor(practitioner.id);
                const minutes = dayMinutes(resolved);
                return (
                  <MobileRecordRow
                    key={practitioner.id}
                    testId={`shift-row-${practitioner.id}`}
                    title={practitioner.name}
                    subtitle={shiftLabel(resolved)}
                    trailing={
                      minutes > 0 ? (
                        <span className="text-[13px] font-medium tabular-nums">
                          {formatHoursLabel(minutes)}
                        </span>
                      ) : undefined
                    }
                    onClick={() =>
                      setOverrideTarget({
                        practitionerId: practitioner.id,
                        practitionerName: practitioner.name,
                        date: selectedKey,
                        resolvedDay: resolved,
                      })
                    }
                  />
                );
              })}
            </MobileRecordList>
          </>
        )}
      </MobilePageShell>

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
