import { Link } from '@tanstack/react-router';
import {
  CalendarOff,
  CalendarRange,
  Columns,
  Grid2x2,
  List,
  Plus,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

import { AddEventDialog } from '@/components/calendar/components/dialogs/add-event-dialog';
import { AppointmentsHeader } from '@/components/calendar/components/header/appointments-header';
import { DateNavigator } from '@/components/calendar/components/header/date-navigator';
import { TodayButton } from '@/components/calendar/components/header/today-button';
import { UserSelect } from '@/components/calendar/components/header/user-select';
import { useCalendar } from '@/components/calendar/contexts/calendar-context';

import type { IEvent } from '@/components/calendar/interfaces';
import type { TCalendarView } from '@/components/calendar/types';

interface IProps {
  view: TCalendarView;
  events: IEvent[];
  basePath?: string;
  /** Hide the day/week/month/agenda view switcher (e.g. a month-only embed). */
  hideViewSwitcher?: boolean;
}

/**
 * Calendar toolbar dispatcher. Resource-column calendars (appointments, the
 * content planner) get the Fresha-style toolbar (per-resource columns,
 * multi-select combobox, view dropdown, Add split button); other embeds keep
 * the legacy layout below.
 */
export function CalendarHeader(props: IProps) {
  const { config } = useCalendar();

  if (config.dayColumnsPerStaff) {
    return <AppointmentsHeader {...props} />;
  }

  return <LegacyCalendarHeader {...props} />;
}

function LegacyCalendarHeader({
  view,
  events,
  basePath = '',
  hideViewSwitcher = false,
}: IProps) {
  const { config } = useCalendar();

  // Use custom dialog if provided, otherwise use default
  const DialogComponent = config.customAddDialog ?? AddEventDialog;
  const SecondaryDialogComponent = config.secondaryAddDialog;

  return (
    <div className="flex flex-col gap-4 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <TodayButton />
        <DateNavigator view={view} events={events} />
      </div>

      <div className="flex flex-col items-center gap-1.5 sm:flex-row sm:justify-between">
        <div className="flex w-full items-center gap-1.5">
          {!hideViewSwitcher && (
            <div className="inline-flex first:rounded-r-none last:rounded-l-none [&:not(:first-child):not(:last-child)]:rounded-none">
              <Button
                asChild
                aria-label="View by day"
                size="icon"
                variant={view === 'day' ? 'default' : 'outline'}
                className="rounded-r-none [&_svg]:size-5"
              >
                <Link to={`${basePath}/day` as never}>
                  <List strokeWidth={1.8} />
                </Link>
              </Button>

              <Button
                asChild
                aria-label="View by week"
                size="icon"
                variant={view === 'week' ? 'default' : 'outline'}
                className="-ml-px rounded-none [&_svg]:size-5"
              >
                <Link to={`${basePath}/week` as never}>
                  <Columns strokeWidth={1.8} />
                </Link>
              </Button>

              <Button
                asChild
                aria-label="View by month"
                size="icon"
                variant={view === 'month' ? 'default' : 'outline'}
                className="-ml-px rounded-none [&_svg]:size-5"
              >
                <Link to={`${basePath}/month` as never}>
                  <Grid2x2 strokeWidth={1.8} />
                </Link>
              </Button>

              <Button
                asChild
                aria-label="View by agenda"
                size="icon"
                variant={view === 'agenda' ? 'default' : 'outline'}
                className="-ml-px rounded-l-none [&_svg]:size-5"
              >
                <Link to={`${basePath}/agenda` as never}>
                  <CalendarRange strokeWidth={1.8} />
                </Link>
              </Button>
            </div>
          )}

          <UserSelect />

          {config.headerAxisToggle}

          {config.headerActions}
        </div>

        <div className="flex w-full gap-1.5 sm:w-auto">
          {SecondaryDialogComponent && (
            <SecondaryDialogComponent>
              <Button variant="outline" className="w-full sm:w-auto">
                <CalendarOff />
                {config.secondaryAddButtonLabel ?? 'Add'}
              </Button>
            </SecondaryDialogComponent>
          )}

          <DialogComponent>
            <Button
              className="w-full sm:w-auto"
              data-claire-target="content-calendar-add-button"
            >
              <Plus />
              {config.labels.addButton}
            </Button>
          </DialogComponent>
        </div>
      </div>
    </div>
  );
}
