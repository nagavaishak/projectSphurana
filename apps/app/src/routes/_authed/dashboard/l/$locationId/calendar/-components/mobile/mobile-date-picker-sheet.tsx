import { isSameDay } from 'date-fns';
import { X } from 'lucide-react';
import { getDefaultClassNames } from 'react-day-picker';
import { Drawer } from 'vaul';

import { useCalendar } from '@/components/calendar';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

interface MobileDatePickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Date picker bottom sheet — opened from the date dropdown in the mobile
 * bookings header. Picking a day sets the calendar's selected date and closes.
 */
export function MobileDatePickerSheet({
  open,
  onOpenChange,
}: MobileDatePickerSheetProps) {
  const { selectedDate, setSelectedDate } = useCalendar();
  const today = new Date();

  const select = (date: Date) => {
    setSelectedDate(date);
    onOpenChange(false);
  };

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[100] bg-black/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-[100] flex max-h-[90dvh] flex-col overflow-hidden rounded-t-[22px] border-t border-border bg-background pb-[max(16px,env(safe-area-inset-bottom,0px))] pt-2.5 outline-none">
          <div className="flex shrink-0 flex-col items-center pt-0.5 pb-1">
            <div
              className="h-1 w-8 shrink-0 rounded-full bg-muted-foreground/30"
              aria-hidden
            />
          </div>

          <div className="flex items-center justify-between px-5 pt-2 pb-1">
            <Drawer.Title className="text-lg font-semibold">
              Select date
            </Drawer.Title>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground active:bg-muted/70"
              aria-label="Close"
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pt-2 pb-4">
            <button
              type="button"
              onClick={() => select(today)}
              disabled={isSameDay(selectedDate, today)}
              className="mb-4 w-full rounded-full border border-border py-2 text-sm font-medium active:bg-accent disabled:opacity-50"
            >
              Today
            </button>

            {/*
              The primitive is `w-fit` with a fixed cell size — on mobile the
              grid should span the sheet, so the root stretches and the cells
              divide the width evenly.
            */}
            <Calendar
              mode="single"
              selected={selectedDate}
              defaultMonth={selectedDate}
              onSelect={(date) => date && select(date)}
              classNames={{ root: cn(getDefaultClassNames().root, 'w-full') }}
              className="w-full p-0 [&_[data-selected-single=true]]:bg-foreground [&_[data-selected-single=true]]:text-background"
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
