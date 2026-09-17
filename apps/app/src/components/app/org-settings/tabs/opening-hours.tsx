'use client';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { LocationOpeningHours } from '@borradh-workspace/api-client/types';
import { Copy } from 'lucide-react';

/**
 * Weekly opening-hours display + editor for organization locations.
 *
 * The map is keyed by day-of-week as a string ("0"=Sunday … "6"=Saturday) with
 * `{ from, to }` minutes-from-midnight. A missing day (or `from === to`) means
 * closed that day. `null` on a location means "inherit the organisation's
 * default hours" — distinct from an empty map, which means closed all week.
 */

const DAY_LABELS: Record<string, string> = {
  '0': 'Sunday',
  '1': 'Monday',
  '2': 'Tuesday',
  '3': 'Wednesday',
  '4': 'Thursday',
  '5': 'Friday',
  '6': 'Saturday',
};

// Monday-first ordering to match the rest of the app; Sunday last.
const DAY_ORDER = ['1', '2', '3', '4', '5', '6', '0'];

function minutesToTimeLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHour}:${mins.toString().padStart(2, '0')} ${period}`;
}

function generateTimeOptions(): { value: number; label: string }[] {
  const options: { value: number; label: string }[] = [];
  for (let minutes = 360; minutes <= 1380; minutes += 30) {
    options.push({ value: minutes, label: minutesToTimeLabel(minutes) });
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

/**
 * Compact, read-only weekly summary rendered on each location card.
 */
export function OpeningHoursSummary({
  openingHours,
}: {
  openingHours: LocationOpeningHours | null;
}) {
  if (!openingHours) {
    return (
      <p className="text-xs text-muted-foreground">
        Uses default opening hours
      </p>
    );
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {DAY_ORDER.map((day) => {
        const hours = openingHours[day];
        const isOpen = hours && hours.from !== hours.to;
        return (
          <div key={day} className="contents">
            <span className="text-xs text-muted-foreground">
              {DAY_LABELS[day]}
            </span>
            <span
              className={cn(
                'text-xs',
                isOpen ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {isOpen
                ? `${minutesToTimeLabel(hours.from)} – ${minutesToTimeLabel(hours.to)}`
                : 'Closed'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Controlled Monday–Sunday hours editor. `value` of `null` is treated as an
 * empty week; toggling any day on produces a concrete map.
 */
export function WeeklyOpeningHoursEditor({
  value,
  onChange,
}: {
  value: LocationOpeningHours | null;
  onChange: (next: LocationOpeningHours) => void;
}) {
  const hoursMap: LocationOpeningHours = value ?? {};

  const toggleDay = (day: string) => {
    const updated = { ...hoursMap };
    if (updated[day]) {
      delete updated[day];
    } else {
      updated[day] = { from: 540, to: 1020 };
    }
    onChange(updated);
  };

  const updateDayTime = (day: string, field: 'from' | 'to', next: number) => {
    if (!hoursMap[day]) return;
    const updated = { ...hoursMap, [day]: { ...hoursMap[day], [field]: next } };

    if (field === 'from' && next >= updated[day].to) {
      updated[day].to = Math.min(next + 30, 1380);
    }
    if (field === 'to' && next <= updated[day].from) {
      updated[day].from = Math.max(next - 30, 360);
    }

    onChange(updated);
  };

  const applyToWeekdays = () => {
    const mondayHours = hoursMap['1'];
    if (!mondayHours) return;
    const updated = { ...hoursMap };
    for (const day of ['2', '3', '4', '5']) {
      updated[day] = { ...mondayHours };
    }
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-2">
      {DAY_ORDER.map((day) => {
        const hours = hoursMap[day];
        const isEnabled = !!hours;

        return (
          <div
            key={day}
            className={cn(
              'flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
              isEnabled ? 'bg-background' : 'bg-muted/30'
            )}
          >
            <Switch
              checked={isEnabled}
              onCheckedChange={() => toggleDay(day)}
              aria-label={`Toggle ${DAY_LABELS[day]}`}
            />

            <span
              className={cn(
                'w-20 text-sm font-medium',
                !isEnabled && 'text-muted-foreground'
              )}
            >
              {DAY_LABELS[day]}
            </span>

            {isEnabled && hours ? (
              <div className="flex items-center gap-2">
                <Select
                  value={String(hours.from)}
                  onValueChange={(v) => updateDayTime(day, 'from', Number(v))}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span className="text-sm text-muted-foreground">to</span>

                <Select
                  value={String(hours.to)}
                  onValueChange={(v) => updateDayTime(day, 'to', Number(v))}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_OPTIONS.filter((opt) => opt.value > hours.from).map(
                      (opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>
                          {opt.label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Closed</span>
            )}
          </div>
        );
      })}

      {hoursMap['1'] && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={applyToWeekdays}
          className="self-start"
        >
          <Copy className="mr-2 h-4 w-4" />
          Apply Monday hours to all weekdays
        </Button>
      )}
    </div>
  );
}
