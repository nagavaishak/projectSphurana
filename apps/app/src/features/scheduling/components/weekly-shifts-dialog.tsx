import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { type ShiftInterval, useSetWeeklyShifts } from '../api';
import {
  ShiftIntervalFields,
  shiftIntervalsInvalid,
  shiftIntervalsOverlap,
} from './shift-interval-fields';

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

export type WeeklyPattern = Record<number, ShiftInterval[]>;

interface WeeklyShiftsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  practitionerId: string;
  practitionerName: string;
  /** Current weekly pattern keyed by dayOfWeek (0=Sunday..6=Saturday). */
  initialPattern: WeeklyPattern;
}

/**
 * Edits a practitioner's standing weekly schedule: per weekday, a toggle
 * plus one or more working intervals. Saving replaces all weekly shift rows
 * for the practitioner (date overrides are untouched).
 */
export function WeeklyShiftsDialog({
  open,
  onOpenChange,
  practitionerId,
  practitionerName,
  initialPattern,
}: WeeklyShiftsDialogProps) {
  const [pattern, setPattern] = useState<WeeklyPattern>({});

  useEffect(() => {
    if (open) setPattern(initialPattern);
  }, [open, initialPattern]);

  const { setWeeklyShifts, isSaving } = useSetWeeklyShifts({
    onSuccess: () => onOpenChange(false),
  });

  const setDay = (day: number, intervals: ShiftInterval[]) => {
    setPattern((prev) => ({ ...prev, [day]: intervals }));
  };

  const invalid = DAY_ORDER.some((day) => {
    const intervals = pattern[day] ?? [];
    return shiftIntervalsInvalid(intervals) || shiftIntervalsOverlap(intervals);
  });

  const handleSave = () => {
    setWeeklyShifts({
      practitionerId,
      days: DAY_ORDER.filter((day) => (pattern[day] ?? []).length > 0).map(
        (day) => ({
          dayOfWeek: day,
          intervals: pattern[day] ?? [],
        })
      ),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit weekly schedule</DialogTitle>
          <DialogDescription>
            {practitionerName}&apos;s standing weekly working hours. Day
            overrides on specific dates are kept.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {DAY_ORDER.map((day) => {
            const intervals = pattern[day] ?? [];
            const enabled = intervals.length > 0;
            return (
              <div key={day} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{DAY_NAMES[day]}</p>
                  <Switch
                    checked={enabled}
                    aria-label={`Working on ${DAY_NAMES[day]}`}
                    onCheckedChange={(next) =>
                      setDay(
                        day,
                        next
                          ? [{ startMinutes: 9 * 60, endMinutes: 17 * 60 }]
                          : []
                      )
                    }
                  />
                </div>
                {enabled && (
                  <div className="mt-3">
                    <ShiftIntervalFields
                      intervals={intervals}
                      onChange={(next) => setDay(day, next)}
                    />
                    {shiftIntervalsOverlap(intervals) && (
                      <p className="mt-2 text-sm text-destructive">
                        Intervals must not overlap.
                      </p>
                    )}
                    {shiftIntervalsInvalid(intervals) && (
                      <p className="mt-2 text-sm text-destructive">
                        Each interval must end after it starts.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isSaving || invalid}
            onClick={handleSave}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
