import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { AddMenu } from '@/components/calendar/components/header/add-menu';
import { DatePickerPopover } from '@/components/calendar/components/header/date-picker-popover';
import { RefreshButton } from '@/components/calendar/components/header/refresh-button';
import { TeamSelect } from '@/components/calendar/components/header/team-select';
import { ViewSelect } from '@/components/calendar/components/header/view-select';
import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { navigateDate, rangeText } from '@/components/calendar/helpers';

import type { IEvent } from '@/components/calendar/interfaces';
import type { TCalendarView } from '@/components/calendar/types';

interface IProps {
  view: TCalendarView;
  events: IEvent[];
  basePath?: string;
  /** Hide the day/week/month view switcher (e.g. a month-only embed). */
  hideViewSwitcher?: boolean;
}

export function AppointmentsHeader({
  view,
  basePath = '',
  hideViewSwitcher = false,
}: IProps) {
  const { config, selectedDate, setSelectedDate } = useCalendar();
  const routerBasePath = config.routerBasePath ?? basePath;

  // The split "Add" menu only makes sense when the calendar has two add modes
  // (an event dialog + a blocked-time dialog, i.e. appointments). A calendar
  // with a single custom add dialog and no secondary dialog (the content
  // planner) gets a direct add button instead: its dialog (AddContentDialog)
  // is uncontrolled and opens from a trigger child, which AddMenu's controlled
  // open state can't drive — so the menu path silently never opens it.
  const AddDialog = config.customAddDialog;
  const useDirectAddButton = !config.secondaryAddDialog && !!AddDialog;

  const dateLabel =
    view === 'day'
      ? format(selectedDate, 'EEE, MMM d')
      : view === 'month'
        ? format(selectedDate, 'MMMM yyyy')
        : rangeText(view, selectedDate);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setSelectedDate(new Date())}>
          Today
        </Button>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous"
            onClick={() =>
              setSelectedDate(navigateDate(selectedDate, view, 'previous'))
            }
          >
            <ChevronLeft className="size-4" />
          </Button>

          <DatePickerPopover view={view} label={dateLabel} />

          <Button
            variant="outline"
            size="icon"
            aria-label="Next"
            onClick={() =>
              setSelectedDate(navigateDate(selectedDate, view, 'next'))
            }
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <TeamSelect />

        {config.headerAxisToggle}

        {config.headerActions}
      </div>

      <div className="flex items-center gap-2">
        <RefreshButton />

        {!hideViewSwitcher && (
          <ViewSelect view={view} basePath={routerBasePath} />
        )}

        {useDirectAddButton && AddDialog ? (
          <AddDialog>
            <Button data-claire-target="content-calendar-add-button">
              <Plus className="size-4" />
              {config.labels.addButton}
            </Button>
          </AddDialog>
        ) : (
          <AddMenu />
        )}
      </div>
    </div>
  );
}
