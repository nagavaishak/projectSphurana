import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import type { ResourceWorkingHours } from '../api';

/**
 * The form-side shape: STRING day keys, because that is what react-hook-form
 * and zod produce for a record. `ResourceWorkingHours` (the wire shape) is
 * number-keyed; `toResourceWorkingHours` below is the one place they meet.
 */
export type WeeklyHours = Record<string, { from: number; to: number }>;

const DAY_LABELS: Record<string, string> = {
  '0': 'Sunday',
  '1': 'Monday',
  '2': 'Tuesday',
  '3': 'Wednesday',
  '4': 'Thursday',
  '5': 'Friday',
  '6': 'Saturday',
};

/** Monday-first, matching the calendar and the practitioner hours editor. */
const DAY_ORDER = ['1', '2', '3', '4', '5', '6', '0'];

/** Wire shape (number keys, or `null` for always-available) -> form shape. */
export const toWeeklyHours = (
  hours: ResourceWorkingHours | null | undefined
): WeeklyHours => Object.fromEntries(Object.entries(hours ?? {}));

/** Form shape -> wire shape. */
export const toResourceWorkingHours = (
  hours: WeeklyHours
): ResourceWorkingHours => {
  const out: ResourceWorkingHours = {};
  for (const [day, range] of Object.entries(hours)) out[Number(day)] = range;
  return out;
};

const DEFAULT_DAY = { from: 540, to: 1020 };

export function minutesToTimeLabel(minutes: number): string {
  if (minutes >= 1440) return 'Midnight';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHour}:${mins.toString().padStart(2, '0')} ${period}`;
}

const TIME_OPTIONS = Array.from({ length: 49 }, (_, i) => {
  const value = i * 30;
  return { value, label: minutesToTimeLabel(value) };
});

interface ResourceWorkingHoursEditorProps {
  value: WeeklyHours;
  onChange: (value: WeeklyHours) => void;
}

/**
 * Weekly availability for ONE resource.
 *
 * Only reachable once "Always available" is switched off — see the long note
 * in `resource-form-dialog.tsx`. A day that is switched off here is a day the
 * room cannot be booked at all.
 */
export function ResourceWorkingHoursEditor({
  value,
  onChange,
}: ResourceWorkingHoursEditorProps) {
  const toggleDay = (day: string) => {
    const next = { ...value };
    if (next[day]) {
      delete next[day];
    } else {
      next[day] = { ...DEFAULT_DAY };
    }
    onChange(next);
  };

  const updateDayTime = (day: string, edge: 'from' | 'to', minutes: number) => {
    const current = value[day];
    if (!current) return;
    const next = { ...value, [day]: { ...current, [edge]: minutes } };
    // Keep the range coherent rather than rejecting the click: dragging the
    // opening past the close should push the close, not raise an error.
    if (edge === 'from' && minutes >= next[day].to) {
      next[day] = { ...next[day], to: Math.min(minutes + 30, 1440) };
    }
    if (edge === 'to' && minutes <= next[day].from) {
      next[day] = { ...next[day], from: Math.max(minutes - 30, 0) };
    }
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1">
      {DAY_ORDER.map((day) => {
        const hours = value[day];
        const isOpen = !!hours;

        return (
          <div
            key={day}
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
              isOpen ? 'bg-background' : 'bg-muted/30'
            )}
          >
            <Switch
              checked={isOpen}
              onCheckedChange={() => toggleDay(day)}
              aria-label={DAY_LABELS[day]}
            />
            <span
              className={cn(
                'w-20 text-sm font-medium',
                !isOpen && 'text-muted-foreground'
              )}
            >
              {DAY_LABELS[day]}
            </span>

            {isOpen ? (
              <div className="flex items-center gap-2">
                <Select
                  value={String(hours.from)}
                  onValueChange={(next) =>
                    updateDayTime(day, 'from', Number(next))
                  }
                >
                  <SelectTrigger
                    className="w-32"
                    aria-label={`${DAY_LABELS[day]} opens at`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {TIME_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={String(option.value)}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">to</span>
                <Select
                  value={String(hours.to)}
                  onValueChange={(next) =>
                    updateDayTime(day, 'to', Number(next))
                  }
                >
                  <SelectTrigger
                    className="w-32"
                    aria-label={`${DAY_LABELS[day]} closes at`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {TIME_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={String(option.value)}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Unavailable</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
