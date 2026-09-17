import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ShiftInterval } from '../api';
import { hhmmToMinutes, minutesToHHmm } from '../lib/time';
import { TimeSelect } from './time-select';

interface ShiftIntervalFieldsProps {
  intervals: ShiftInterval[];
  onChange: (intervals: ShiftInterval[]) => void;
  disabled?: boolean;
}

const DEFAULT_INTERVAL: ShiftInterval = {
  startMinutes: 9 * 60,
  endMinutes: 17 * 60,
};

/** Suggest the next interval after the latest existing one. */
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
 * Editable list of shift intervals (multiple working periods per day),
 * with 5-minute increment time selects.
 */
export function ShiftIntervalFields({
  intervals,
  onChange,
  disabled,
}: ShiftIntervalFieldsProps) {
  const update = (index: number, patch: Partial<ShiftInterval>) => {
    onChange(
      intervals.map((interval, i) =>
        i === index ? { ...interval, ...patch } : interval
      )
    );
  };

  return (
    <div className="space-y-2">
      {intervals.map((interval, index) => (
        <div key={index} className="flex items-center gap-2">
          <TimeSelect
            value={minutesToHHmm(interval.startMinutes)}
            onChange={(v) => update(index, { startMinutes: hhmmToMinutes(v) })}
            disabled={disabled}
            className="flex-1"
          />
          <span className="text-sm text-muted-foreground">–</span>
          <TimeSelect
            value={minutesToHHmm(interval.endMinutes)}
            onChange={(v) => update(index, { endMinutes: hhmmToMinutes(v) })}
            disabled={disabled}
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Remove interval"
            disabled={disabled}
            onClick={() => onChange(intervals.filter((_, i) => i !== index))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={disabled}
        onClick={() => onChange([...intervals, nextInterval(intervals)])}
      >
        <Plus className="size-4" />
        Add interval
      </Button>
    </div>
  );
}

/** True when any two intervals overlap (mirror of the backend invariant). */
export function shiftIntervalsOverlap(intervals: ShiftInterval[]): boolean {
  const sorted = [...intervals].sort((a, b) => a.startMinutes - b.startMinutes);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMinutes < sorted[i - 1].endMinutes) return true;
  }
  return false;
}

/** True when any interval is empty or inverted. */
export function shiftIntervalsInvalid(intervals: ShiftInterval[]): boolean {
  return intervals.some((i) => i.startMinutes >= i.endMinutes);
}
