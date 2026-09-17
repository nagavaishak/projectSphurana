import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SingleCalendar } from '@/components/ui/single-calendar';
import { cn } from '@/lib/utils';

import * as React from 'react';

export interface DatePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  /** Display format for the selected date (date-fns). Defaults to `PP`. */
  displayFormat?: string;
  id?: string;
  disabled?: boolean;
  /** Optional day matcher forwarded to the calendar (e.g. `{ before: new Date() }`). */
  calendarDisabled?: React.ComponentProps<typeof SingleCalendar>['disabled'];
  className?: string;
  'aria-invalid'?: boolean;
}

/**
 * Canonical shadcn date picker: a Popover-triggering button that shows the
 * selected date (or a muted placeholder when empty) and a calendar to pick one.
 * Use this everywhere instead of a native `<input type="date">`.
 */
export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  displayFormat = 'PP',
  id,
  disabled,
  calendarDisabled,
  className,
  'aria-invalid': ariaInvalid,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={ariaInvalid}
          className={cn(
            'w-full justify-start text-left font-normal',
            !value && 'text-muted-foreground',
            className
          )}
        >
          <CalendarIcon className="mr-2 size-4 shrink-0" />
          {value ? format(value, displayFormat) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <SingleCalendar
          mode="single"
          selected={value}
          disabled={calendarDisabled}
          onSelect={(date) => {
            onChange?.(date);
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
