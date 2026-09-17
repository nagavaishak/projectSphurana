import { format, parse } from 'date-fns';
import { Plus, Trash2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import {
  type ResolvedShiftDay,
  type ShiftInterval,
  useDeleteShiftOverride,
  useSetShiftOverride,
} from '../api';
import { formatHoursLabel, hhmmToMinutes, minutesToHHmm } from '../lib/time';
import {
  shiftIntervalsInvalid,
  shiftIntervalsOverlap,
} from './shift-interval-fields';
import { TimeSelect } from './time-select';

interface ShiftOverrideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  practitionerId: string;
  practitionerName: string;
  /** YYYY-MM-DD */
  date: string;
  /** The currently resolved day (overrides applied), used to seed the form. */
  resolvedDay: ResolvedShiftDay | null;
}

const DEFAULT_INTERVAL: ShiftInterval = {
  startMinutes: 10 * 60,
  endMinutes: 19 * 60,
};

/** Suggest the next shift starting after the latest existing one. */
function nextInterval(intervals: ShiftInterval[]): ShiftInterval {
  if (intervals.length === 0) return DEFAULT_INTERVAL;
  const latestEnd = Math.max(...intervals.map((i) => i.endMinutes));
  const start = Math.min(latestEnd + 60, 23 * 60);
  return {
    startMinutes: start,
    endMinutes: Math.min(start + 120, 24 * 60 - 5),
  };
}

/**
 * Edits a single day's shifts for one practitioner. Saving writes a date
 * override (which replaces the weekly pattern for that date); removing all
 * shifts (or the delete-day action) resets the day to "not working".
 */
export function ShiftOverrideDialog({
  open,
  onOpenChange,
  practitionerId,
  practitionerName,
  date,
  resolvedDay,
}: ShiftOverrideDialogProps) {
  const [intervals, setIntervals] = useState<ShiftInterval[]>([]);

  useEffect(() => {
    if (!open) return;
    const seeded =
      resolvedDay && !resolvedDay.isOff
        ? resolvedDay.intervals.map((i) => ({
            startMinutes: i.startMinutes,
            endMinutes: i.endMinutes,
          }))
        : [];
    setIntervals(seeded.length > 0 ? seeded : [DEFAULT_INTERVAL]);
  }, [open, resolvedDay]);

  const { setShiftOverride, isSaving } = useSetShiftOverride({
    onSuccess: () => onOpenChange(false),
  });
  const { deleteShiftOverride, isDeleting } = useDeleteShiftOverride({
    onSuccess: () => onOpenChange(false),
  });

  const hasOverride = resolvedDay?.source === 'override';
  const totalMinutes = intervals.reduce(
    (sum, i) => sum + Math.max(0, i.endMinutes - i.startMinutes),
    0
  );
  const invalid =
    intervals.length > 0 &&
    (shiftIntervalsInvalid(intervals) || shiftIntervalsOverlap(intervals));

  const update = (index: number, patch: Partial<ShiftInterval>) =>
    setIntervals((prev) =>
      prev.map((interval, i) =>
        i === index ? { ...interval, ...patch } : interval
      )
    );

  const removeInterval = (index: number) =>
    setIntervals((prev) => prev.filter((_, i) => i !== index));

  const handleSave = () => {
    const isOff = intervals.length === 0;
    setShiftOverride({
      practitionerId,
      date,
      isOff,
      intervals: isOff ? [] : intervals,
    });
  };

  // Delete-day: drop an existing override, or turn a weekly day off for
  // this date via an "off" override.
  const handleDeleteDay = () => {
    if (hasOverride) {
      deleteShiftOverride({ practitionerId, date });
    } else {
      setShiftOverride({ practitionerId, date, isOff: true, intervals: [] });
    }
  };

  const firstName = practitionerName.split(' ')[0] || practitionerName;
  const displayDate = format(
    parse(date, 'yyyy-MM-dd', new Date()),
    'EEE, MMM d'
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {firstName}&apos;s shift {displayDate}
          </DialogTitle>
          <DialogDescription>
            You are editing this day&apos;s shifts only. To set repeating
            shifts, go to scheduled shifts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {intervals.length === 0 ? (
            <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
              Not working this day.
            </p>
          ) : (
            intervals.map((interval, index) => (
              <div key={index} className="flex items-end gap-3">
                <div className="flex-1 space-y-1.5">
                  {index === 0 && <Label>Start time</Label>}
                  <TimeSelect
                    className="w-full"
                    value={minutesToHHmm(interval.startMinutes)}
                    onChange={(v) =>
                      update(index, { startMinutes: hhmmToMinutes(v) })
                    }
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  {index === 0 && <Label>End time</Label>}
                  <TimeSelect
                    className="w-full"
                    value={minutesToHHmm(interval.endMinutes)}
                    onChange={(v) =>
                      update(index, { endMinutes: hhmmToMinutes(v) })
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  aria-label="Remove shift"
                  onClick={() => removeInterval(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}

          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-full"
              onClick={() =>
                setIntervals((prev) => [...prev, nextInterval(prev)])
              }
            >
              <Plus className="size-4" />
              Add shift
            </Button>
            {intervals.length > 0 && (
              <span className="text-sm text-muted-foreground">
                Total shift duration: {formatHoursLabel(totalMinutes)}
              </span>
            )}
          </div>

          {intervals.length > 0 && shiftIntervalsOverlap(intervals) && (
            <p className="text-sm text-destructive">Shifts must not overlap.</p>
          )}
          {shiftIntervalsInvalid(intervals) && (
            <p className="text-sm text-destructive">
              Each shift must end after it starts.
            </p>
          )}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label="Delete this day's shifts"
            disabled={isDeleting || isSaving}
            onClick={handleDeleteDay}
          >
            <Trash2 className="size-5" />
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-full"
              disabled={isSaving || invalid}
              onClick={handleSave}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
