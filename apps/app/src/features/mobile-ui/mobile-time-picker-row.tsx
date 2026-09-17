import { ChevronRight, Clock } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import {
  MOBILE_TIME_OPTIONS,
  formatMobileTimeLabel,
} from './mobile-time-options';

interface MobileTimePickerRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/** Popover time list (same pattern as date row + onboarding time options). */
export function MobileTimePickerRow({
  label,
  value,
  onChange,
  className,
}: MobileTimePickerRowProps) {
  const [open, setOpen] = useState(false);
  const displayValue = useMemo(() => formatMobileTimeLabel(value), [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-[#F9F9F9]',
            className
          )}
        >
          <Clock
            className="size-5 shrink-0 text-[#8E8E93]"
            strokeWidth={1.75}
          />
          <span className="min-w-0 flex-1 text-[13px] text-[#8E8E93]">
            {label}
          </span>
          <span className="shrink-0 text-[13px] font-medium text-black">
            {displayValue}
          </span>
          <ChevronRight
            className="size-4 shrink-0 text-[#C7C7CC]"
            strokeWidth={2}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-36 p-0">
        <ScrollArea className="h-[240px]">
          <ul className="p-1">
            {MOBILE_TIME_OPTIONS.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-[13px] active:bg-[#F9F9F9]',
                    value === option.value
                      ? 'font-medium text-black'
                      : 'text-[#3C3C43]'
                  )}
                >
                  {option.label}
                  {value === option.value ? (
                    <span className="text-[12px] text-[#8E8E93]">✓</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
