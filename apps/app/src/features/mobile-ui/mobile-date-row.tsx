import { Calendar, ChevronRight } from 'lucide-react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SingleCalendar } from '@/components/ui/single-calendar';
import { cn } from '@/lib/utils';

interface MobileDateRowProps {
  label?: string;
  value: string;
  selected: Date;
  onSelect: (date: Date) => void;
  className?: string;
}

/** Date row using the same Popover + SingleCalendar pattern as mobile bookings day view. */
export function MobileDateRow({
  label = 'Date',
  value,
  selected,
  onSelect,
  className,
}: MobileDateRowProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-[#F9F9F9]',
            className
          )}
        >
          <Calendar
            className="size-5 shrink-0 text-[#8E8E93]"
            strokeWidth={1.75}
          />
          <span className="min-w-0 flex-1 text-[13px] text-[#8E8E93]">
            {label}
          </span>
          <span className="shrink-0 text-[13px] font-medium text-black">
            {value}
          </span>
          <ChevronRight
            className="size-4 shrink-0 text-[#C7C7CC]"
            strokeWidth={2}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-fit p-0">
        <SingleCalendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) {
              onSelect(date);
            }
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
