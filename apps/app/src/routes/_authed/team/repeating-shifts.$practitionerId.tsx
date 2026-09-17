import { useResolvedRoutes } from '@/lib/use-routes';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { addDays, endOfWeek, format, startOfWeek } from 'date-fns';
import { ChevronDown, Info, Plus, Store, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SingleCalendar } from '@/components/ui/single-calendar';
import { useListLocations } from '@/features/organization-locations';
import { useListPractitioners } from '@/features/practitioners';
import {
  type ShiftInterval,
  TimeSelect,
  type WeeklyPattern,
  formatHoursLabel,
  hhmmToMinutes,
  minutesToHHmm,
  shiftIntervalsInvalid,
  shiftIntervalsOverlap,
  useListShifts,
  useSetWeeklyShifts,
} from '@/features/scheduling';
export const Route = createFileRoute(
  '/_authed/team/repeating-shifts/$practitionerId'
)({
  component: RepeatingShiftsPage,
});

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** Render order: Monday-first, matching the shifts grid. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const DEFAULT_INTERVAL: ShiftInterval = {
  startMinutes: 10 * 60,
  endMinutes: 19 * 60,
};

const SCHEDULE_TYPES = {
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  custom: 'Custom',
} as const;

const ENDS_OPTIONS = {
  never: 'Ongoing (no end date)',
  onDate: 'Specific date',
} as const;

function intervalMinutes(intervals: ShiftInterval[]): number {
  return intervals.reduce((sum, i) => sum + (i.endMinutes - i.startMinutes), 0);
}

function RepeatingShiftsPage() {
  const { practitionerId } = Route.useParams();
  const navigate = useNavigate();
  const routes = useResolvedRoutes();

  const { practitioners } = useListPractitioners({});
  const practitioner = practitioners.find((p) => p.id === practitionerId);
  const practitionerName = practitioner?.name ?? 'team member';
  const firstName = practitionerName.split(' ')[0];

  const { locations } = useListLocations();
  const primaryLocation =
    locations.find((l) => l.isPrimary) ?? locations[0] ?? null;

  const weekStart = useMemo(() => startOfWeek(new Date()), []);
  const weekEnd = useMemo(() => endOfWeek(new Date()), []);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  // Seed the editor from the practitioner's current standing weekly pattern.
  const { shiftDays, isLoading: isShiftsLoading } = useListShifts({
    from: weekStart.toISOString(),
    to: weekEnd.toISOString(),
    practitionerId,
  });

  const [pattern, setPattern] = useState<WeeklyPattern>({});
  const [seeded, setSeeded] = useState(false);
  const [scheduleType, setScheduleType] =
    useState<keyof typeof SCHEDULE_TYPES>('weekly');
  const [startDate, setStartDate] = useState<Date>(() => new Date());
  const [endsOption, setEndsOption] = useState<keyof typeof ENDS_OPTIONS | ''>(
    ''
  );

  // Reconstruct the weekly pattern once the shifts query has SETTLED (weekly-
  // source days only). Gate on `isShiftsLoading` — not on `shiftDays.length` —
  // so a practitioner with no standing shifts still seeds exactly once and marks
  // `seeded`. Otherwise the effect keeps firing as the query resolves and can
  // overwrite a day the user just toggled on before the (empty) data landed.
  useEffect(() => {
    if (seeded || isShiftsLoading) return;
    const byDate = new Map(shiftDays.map((d) => [d.date, d]));
    const next: WeeklyPattern = {};
    for (const date of weekDays) {
      const resolved = byDate.get(format(date, 'yyyy-MM-dd'));
      if (resolved && resolved.source === 'weekly' && !resolved.isOff) {
        next[resolved.dayOfWeek] = resolved.intervals.map((i) => ({
          startMinutes: i.startMinutes,
          endMinutes: i.endMinutes,
        }));
      }
    }
    setPattern(next);
    setSeeded(true);
  }, [shiftDays, weekDays, seeded, isShiftsLoading]);

  const setDay = (day: number, intervals: ShiftInterval[]) =>
    setPattern((prev) => ({ ...prev, [day]: intervals }));

  const toggleDay = (day: number, on: boolean) =>
    setDay(day, on ? [{ ...DEFAULT_INTERVAL }] : []);

  const updateInterval = (
    day: number,
    index: number,
    patch: Partial<ShiftInterval>
  ) =>
    setDay(
      day,
      (pattern[day] ?? []).map((interval, i) =>
        i === index ? { ...interval, ...patch } : interval
      )
    );

  const addInterval = (day: number) => {
    const intervals = pattern[day] ?? [];
    const latestEnd =
      intervals.length > 0
        ? Math.max(...intervals.map((i) => i.endMinutes))
        : DEFAULT_INTERVAL.startMinutes;
    const start = Math.min(latestEnd + 60, 23 * 60);
    setDay(day, [
      ...intervals,
      { startMinutes: start, endMinutes: Math.min(start + 120, 24 * 60 - 5) },
    ]);
  };

  const removeInterval = (day: number, index: number) =>
    setDay(
      day,
      (pattern[day] ?? []).filter((_, i) => i !== index)
    );

  const totalMinutes = DAY_ORDER.reduce(
    (sum, day) => sum + intervalMinutes(pattern[day] ?? []),
    0
  );

  const invalid = DAY_ORDER.some((day) => {
    const intervals = pattern[day] ?? [];
    return shiftIntervalsInvalid(intervals) || shiftIntervalsOverlap(intervals);
  });

  const close = () => navigate({ to: routes.teamShifts });

  const { setWeeklyShifts, isSaving } = useSetWeeklyShifts({
    onSuccess: () => close(),
  });

  const handleSave = () => {
    setWeeklyShifts({
      practitionerId,
      days: DAY_ORDER.filter((day) => (pattern[day] ?? []).length > 0).map(
        (day) => ({ dayOfWeek: day, intervals: pattern[day] ?? [] })
      ),
    });
  };

  return (
    <>
      <title>Set repeating shifts | Borradh</title>
      <div className="min-h-dvh bg-background">
        {/* Sticky action header */}
        <header className="sticky top-0 z-10 flex items-center justify-end gap-2 bg-background/95 px-6 py-4 backdrop-blur">
          <Button
            variant="outline"
            className="rounded-full px-6"
            onClick={close}
          >
            Close
          </Button>
          <Button
            className="rounded-full px-6"
            disabled={invalid || isSaving}
            onClick={handleSave}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </header>

        <div className="mx-auto max-w-5xl px-6 pb-24">
          <h1 className="text-3xl font-bold tracking-tight">
            Set {firstName}&apos;s repeating shifts
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Set weekly, biweekly or custom shifts. Changes saved will apply to
            all upcoming shifts for the selected period.
          </p>

          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,380px)_1fr]">
            {/* Left: schedule settings */}
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border p-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Store className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {primaryLocation?.name ?? 'Business location'}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {primaryLocation?.addressLine1 ??
                      'No business address added'}
                  </p>
                </div>
              </div>

              <div className="space-y-5 rounded-xl border p-4">
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold">Schedule type</p>
                  <Select
                    value={scheduleType}
                    onValueChange={(v) =>
                      setScheduleType(v as keyof typeof SCHEDULE_TYPES)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SCHEDULE_TYPES).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <p className="text-sm font-semibold">Start date</p>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-between font-normal"
                      >
                        {format(startDate, 'MMM d, yyyy')}
                        <ChevronDown className="size-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <SingleCalendar
                        selected={startDate}
                        onSelect={(d) => d && setStartDate(d)}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-1.5">
                  <p className="text-sm font-semibold">Ends</p>
                  <Select
                    value={endsOption}
                    onValueChange={(v) =>
                      setEndsOption(v as keyof typeof ENDS_OPTIONS)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ENDS_OPTIONS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-5 shrink-0" />
                <p>
                  Team members will not be scheduled on business closed periods.
                </p>
              </div>
            </div>

            {/* Right: weekly editor */}
            <div>
              <p className="text-xl font-semibold">
                {SCHEDULE_TYPES[scheduleType] === 'Every week'
                  ? 'Weekly'
                  : SCHEDULE_TYPES[scheduleType]}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {formatHoursLabel(totalMinutes)} total
              </p>

              <div className="mt-4 space-y-2">
                {/* Only render the interactive day grid once the standing
                    pattern has seeded — otherwise a checkbox toggled during the
                    initial load is wiped when the (async) seed replaces the
                    pattern wholesale. */}
                {!seeded ? (
                  <p className="py-8 text-sm text-muted-foreground">
                    Loading shifts…
                  </p>
                ) : (
                  DAY_ORDER.map((day) => {
                    const intervals = pattern[day] ?? [];
                    const working = intervals.length > 0;
                    return (
                      <div key={day} className="rounded-lg py-2">
                        {/*
                          Responsive day row. This was a rigid flex row: a fixed
                          `w-40` label column beside two `w-32` time selects, which
                          needs ~580px and so overflowed a 412px phone HORIZONTALLY
                          (the page body scrolled sideways and controls were cut off
                          at the viewport edge). On small screens the label now sits
                          ABOVE the intervals and the intervals wrap.
                        */}
                        <div className="flex flex-col items-start gap-2 sm:flex-row sm:gap-4">
                          <div className="flex w-full shrink-0 items-start gap-3 pt-2.5 sm:w-40">
                            <Checkbox
                              checked={working}
                              onCheckedChange={(c) =>
                                toggleDay(day, c === true)
                              }
                              aria-label={DAY_NAMES[day]}
                            />
                            <div className="leading-tight">
                              <span className="block text-sm font-medium">
                                {DAY_NAMES[day]}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {working
                                  ? formatHoursLabel(intervalMinutes(intervals))
                                  : 'Not working'}
                              </span>
                            </div>
                          </div>

                          {working ? (
                            <div className="w-full flex-1 space-y-2">
                              {intervals.map((interval, index) => (
                                <div
                                  key={index}
                                  className="flex flex-wrap items-center gap-3"
                                >
                                  <TimeSelect
                                    className="w-32"
                                    value={minutesToHHmm(interval.startMinutes)}
                                    onChange={(v) =>
                                      updateInterval(day, index, {
                                        startMinutes: hhmmToMinutes(v),
                                      })
                                    }
                                  />
                                  <span className="text-sm text-muted-foreground">
                                    to
                                  </span>
                                  <TimeSelect
                                    className="w-32"
                                    value={minutesToHHmm(interval.endMinutes)}
                                    onChange={(v) =>
                                      updateInterval(day, index, {
                                        endMinutes: hhmmToMinutes(v),
                                      })
                                    }
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 shrink-0 text-muted-foreground"
                                    aria-label="Add another interval"
                                    onClick={() => addInterval(day)}
                                  >
                                    <Plus className="size-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    aria-label="Remove interval"
                                    onClick={() => removeInterval(day, index)}
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex-1 pt-2.5 text-sm text-muted-foreground">
                              Not working
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {invalid && (
                <p className="mt-3 text-sm text-destructive">
                  Each shift must end after it starts, and shifts on the same
                  day must not overlap.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
