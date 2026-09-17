import { Button } from '@/components/ui/button';
import { FieldError, FieldGroup } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Copy } from 'lucide-react';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface StepWorkingHoursProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

type WorkingHours = Record<string, { from: number; to: number }>;

const DAY_LABELS: Record<string, string> = {
  '0': 'Sunday',
  '1': 'Monday',
  '2': 'Tuesday',
  '3': 'Wednesday',
  '4': 'Thursday',
  '5': 'Friday',
  '6': 'Saturday',
};

const DAY_ORDER = ['1', '2', '3', '4', '5', '6', '0'];

function generateTimeOptions(): { value: number; label: string }[] {
  const options: { value: number; label: string }[] = [];
  for (let minutes = 360; minutes <= 1380; minutes += 30) {
    options.push({ value: minutes, label: minutesToTimeLabel(minutes) });
  }
  return options;
}

function minutesToTimeLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHour}:${mins.toString().padStart(2, '0')} ${period}`;
}

const TIME_OPTIONS = generateTimeOptions();

export function StepWorkingHours({ form }: StepWorkingHoursProps) {
  const workingHours: WorkingHours = form.watch('workingHours') || {};

  const updateHours = (newHours: WorkingHours) => {
    form.setValue('workingHours', newHours, { shouldDirty: true });
  };

  const toggleDay = (day: string) => {
    const updated = { ...workingHours };
    if (updated[day]) {
      delete updated[day];
    } else {
      updated[day] = { from: 540, to: 1020 };
    }
    updateHours(updated);
  };

  const updateDayTime = (day: string, field: 'from' | 'to', value: number) => {
    if (!workingHours[day]) return;
    const updated = { ...workingHours };
    updated[day] = { ...updated[day], [field]: value };

    if (field === 'from' && value >= updated[day].to) {
      updated[day].to = Math.min(value + 30, 1380);
    }
    if (field === 'to' && value <= updated[day].from) {
      updated[day].from = Math.max(value - 30, 360);
    }

    updateHours(updated);
  };

  const applyToWeekdays = () => {
    const mondayHours = workingHours['1'];
    if (!mondayHours) return;

    const updated = { ...workingHours };
    for (const day of ['2', '3', '4', '5']) {
      updated[day] = { ...mondayHours };
    }
    updateHours(updated);
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Set your working hours</h1>
        <p className="text-muted-foreground">
          When are you available for bookings? This can differ from the
          business&apos;s opening hours.
        </p>
      </div>

      <Controller
        name="workingHours"
        control={form.control}
        render={({ fieldState }) => (
          <>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </>
        )}
      />

      <div className="flex flex-col gap-1">
        {DAY_ORDER.map((day) => {
          const isEnabled = !!workingHours[day];
          const hours = workingHours[day];

          return (
            <div
              key={day}
              className={cn(
                'flex items-center gap-4 rounded-lg border px-4 py-3 transition-colors',
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
                  'w-24 text-sm font-medium',
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
                    <SelectTrigger className="w-[130px]">
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
                    <SelectTrigger className="w-[130px]">
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
                <span className="text-sm text-muted-foreground">Off</span>
              )}
            </div>
          );
        })}
      </div>

      {workingHours['1'] && (
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
    </FieldGroup>
  );
}
