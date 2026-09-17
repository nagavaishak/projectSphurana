'use client';

/**
 * §6.2 week view — a CAPACITY grid, not seven day views side by side.
 *
 * The existing week view is the wrong shape: it draws every appointment across
 * seven columns, which is unreadable at three practitioners and a wall at
 * eight. The question a week view is asked is “where is there room, and who is
 * drowning” — one number per practitioner per day, coloured by slack.
 *
 * ## What came off it
 *
 * Each cell used to carry its count AND a “3 slots left” caption, under a
 * four-card legend explaining the colours. That is the colour doing its job
 * and then being explained twice. The caption is gone, the legend is in the
 * notes drawer, and what is left is a grid you read in one sweep: dark red
 * rows are people to protect, pale green cells are where Claire should push a
 * lapsed patient.
 */

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import { PRACTITIONERS, WEEK_DAYS, WEEK_GRID, type WfWeekCell } from './mock';

/**
 * Capacity colour. Thresholds are on SLOTS REMAINING, not on a percentage: a
 * practitioner with one slot left is equally close to full whether their day
 * holds 6 appointments or 12, and a percentage scale hides that.
 */
function cellTone(cell: WfWeekCell) {
  if (cell.booked === null) {
    return null;
  }
  const remaining = cell.capacity - cell.booked;
  if (remaining <= 0) {
    return {
      className: 'bg-destructive/15 text-destructive dark:bg-destructive/25',
      label: 'Fully booked',
    };
  }
  if (remaining <= 2) {
    return {
      className:
        'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
      label: `${remaining} slot${remaining === 1 ? '' : 's'} left`,
    };
  }
  return {
    className:
      'bg-green-100 text-green-900 dark:bg-green-950/50 dark:text-green-200',
    label: `${remaining} slots left`,
  };
}

function clinicTotal(index: number) {
  const cells = PRACTITIONERS.map((p) => WEEK_GRID[p.id]?.[index]).filter(
    (cell): cell is WfWeekCell => Boolean(cell)
  );
  return {
    booked: cells.reduce((sum, cell) => sum + (cell.booked ?? 0), 0),
    capacity: cells.reduce(
      (sum, cell) => sum + (cell.booked === null ? 0 : cell.capacity),
      0
    ),
  };
}

export function WfCalendarWeek() {
  const [selected, setSelected] = useState<string | null>('marek-2');

  return (
    <WfFrame
      location="Calendar › Week"
      name="Calendar — week"
      notes={
        <>
          <WfPoint title="The cell is a count, not a list">
            Green is three or more slots free, amber is one or two, red is full.
            Clicking a cell opens the day view filtered to that practitioner,
            which is where individual appointments belong.
          </WfPoint>
          <WfPoint title="Hatched is not the same as empty">
            A non-working day and a working day with zero bookings look
            identical if both render blank, and they are opposite facts: one is
            closed, the other is the greenest cell on the grid and the one an
            owner most wants to find.
          </WfPoint>
          <WfPoint title="Thresholds are on slots, not percentages">
            One slot left is equally close to full whether the day holds six
            appointments or twelve. A percentage scale would call the busier
            practitioner the freer one.
          </WfPoint>
          <WfPoint title="Colour is not captioned">
            Each cell used to repeat its colour in words (“3 slots left”) under
            a four-card legend saying the same thing again. The number and the
            colour are the content; the legend is here instead.
          </WfPoint>
          <WfPoint title="A row of red is the real output">
            The week view earns its place when it makes a staffing case — a
            practitioner red five days running is the argument for another
            clinic day, and that is a shape, not a number.
          </WfPoint>
        </>
      }
    >
      <DashboardPage
        description="Where there is room, and who is drowning"
        title="16–22 March 2026"
        toolbar={
          <div className="flex items-center gap-2">
            <Button size="icon" type="button" variant="outline">
              <ChevronLeftIcon />
              <span className="sr-only">Previous week</span>
            </Button>
            <Button size="icon" type="button" variant="outline">
              <ChevronRightIcon />
              <span className="sr-only">Next week</span>
            </Button>
            <Button size="sm" type="button" variant="outline">
              This week
            </Button>
            <span className="ml-auto flex items-center rounded-lg border p-0.5">
              {(['Day', 'Week'] as const).map((option) => (
                <button
                  className={cn(
                    'rounded-md px-3 py-1 font-medium text-sm transition-colors',
                    option === 'Week'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  key={option}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </span>
          </div>
        }
      >
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[680px] border-collapse">
            <thead>
              <tr className="border-b">
                <th className="w-44 px-4 py-2.5 text-left font-medium text-sm">
                  Practitioner
                </th>
                {WEEK_DAYS.map((day) => (
                  <th
                    className="px-2 py-2.5 text-center font-medium text-sm"
                    key={day.id}
                  >
                    {day.label}{' '}
                    <span className="text-muted-foreground tabular-nums">
                      {day.date}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PRACTITIONERS.map((practitioner) => (
                <tr key={practitioner.id}>
                  <td className="px-4 py-1.5">
                    <p className="truncate font-medium text-sm">
                      {practitioner.short}
                    </p>
                    <p className="truncate text-muted-foreground text-xs">
                      {practitioner.role}
                    </p>
                  </td>
                  {WEEK_DAYS.map((day, index) => {
                    const cell = WEEK_GRID[practitioner.id]?.[index];
                    const tone = cell ? cellTone(cell) : null;
                    const key = `${practitioner.id}-${index}`;

                    if (!(cell && tone)) {
                      return (
                        <td className="p-1" key={day.id}>
                          <div
                            className="h-12 rounded-md bg-[repeating-linear-gradient(45deg,var(--color-muted)_0px,var(--color-muted)_4px,transparent_4px,transparent_8px)]"
                            title="Not working"
                          />
                        </td>
                      );
                    }

                    return (
                      <td className="p-1" key={day.id}>
                        <button
                          className={cn(
                            'h-12 w-full rounded-md font-semibold text-lg tabular-nums transition-opacity hover:opacity-80',
                            tone.className,
                            selected === key && 'ring-2 ring-primary'
                          )}
                          onClick={() => setSelected(key)}
                          title={`${practitioner.short} · ${day.label} ${day.date} Mar · ${tone.label}`}
                          type="button"
                        >
                          {cell.booked}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Derived from the same cells rather than typed as a separate
                  fixture, so a reviewer changing one number cannot make the
                  footer disagree with the grid above it. */}
              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground text-sm">
                  Clinic total
                </td>
                {WEEK_DAYS.map((day, index) => {
                  const total = clinicTotal(index);
                  return (
                    <td className="px-2 py-3 text-center text-sm" key={day.id}>
                      <span className="font-medium tabular-nums">
                        {total.booked}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        /{total.capacity}
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </DashboardPage>
    </WfFrame>
  );
}
