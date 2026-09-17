import { format } from 'date-fns';
import { ChevronDown, Menu } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useCalendar } from '@/components/calendar';
import {
  MobileHeaderIconButton,
  useMobileDashboardHeaderContent,
} from '@/features/mobile-dashboard-header';

import { MobileDatePickerSheet } from './mobile-date-picker-sheet';
import { MobileViewOptionsSheet } from './mobile-view-options-sheet';

import type { TCalendarView } from '@/components/calendar/types';

interface MobileBookingsHeaderProps {
  view: TCalendarView;
  basePath: string;
}

/** Month-scoped views read as a month; the rest are anchored on a single day. */
function headerLabel(view: TCalendarView, date: Date) {
  if (view === 'month' || view === 'agenda') return format(date, 'MMMM yyyy');
  if (view === 'year') return format(date, 'yyyy');
  return format(date, 'EEE, MMM d');
}

/**
 * Mobile bookings header (Fresha-style): a burger on the leading edge that
 * opens view + filter options, and the current date as a dropdown that opens
 * the date picker. Both are rendered into the shared mobile dashboard header,
 * so the page itself contributes no chrome — only the two sheets.
 */
export function MobileBookingsHeader({
  view,
  basePath,
}: MobileBookingsHeaderProps) {
  const { selectedDate } = useCalendar();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const leadingSlot = useMemo(
    () => (
      <MobileHeaderIconButton
        aria-label="View and filter options"
        onClick={() => setOptionsOpen(true)}
      >
        <Menu className="size-5 text-[#525252]" strokeWidth={2} />
      </MobileHeaderIconButton>
    ),
    []
  );

  const label = headerLabel(view, selectedDate);
  const titleSlot = useMemo(
    () => (
      <button
        type="button"
        onClick={() => setDatePickerOpen(true)}
        aria-label="Change date"
        className="-mx-1 flex min-w-0 items-center gap-1 rounded-full px-1 py-1 active:bg-black/5"
      >
        <span className="truncate text-[19px] font-semibold leading-tight text-[#0A0A0A]">
          {label}
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-[#525252]"
          strokeWidth={2.5}
        />
      </button>
    ),
    [label]
  );

  useMobileDashboardHeaderContent({ leadingSlot, titleSlot });

  return (
    <>
      <MobileViewOptionsSheet
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        view={view}
        basePath={basePath}
      />
      <MobileDatePickerSheet
        open={datePickerOpen}
        onOpenChange={setDatePickerOpen}
      />
    </>
  );
}
