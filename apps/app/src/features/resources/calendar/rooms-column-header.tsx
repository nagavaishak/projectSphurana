import { Link } from '@tanstack/react-router';
import { DoorOpen, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useBranchRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';
import { resourceCategoryKindSingularLabels } from '@borradh-workspace/api-client/types';

import type { IUser } from '@/components/calendar';

import { useRoomsCalendar } from './rooms-calendar-context';
import { UNASSIGNED_ROOM_ID, UTILISATION_TARGET } from './rooms-calendar-model';

interface RoomsColumnHeaderProps {
  staff: IUser;
  children: React.ReactNode;
}

/**
 * `whitespace-nowrap` is load-bearing. This label renders in TWO places: a
 * wide day column, and the 96px-wide rail of the week/3-day grid where rooms
 * are the rows. Without it, "26% booked" broke across two lines in the rail
 * while "55% booked" stayed on one, so sibling rows didn't even line up.
 */
/**
 * The library gives this component a FIXED-HEIGHT cell (`HEADER_PX`, 96px) that
 * already holds a 56px avatar plus the room name. The utilisation line we add
 * beneath has to fit in what's left — roughly 16px — so it is 10px text with
 * `leading-none` and a hairline gap.
 *
 * `h-full` + `overflow-hidden` is the guard, not the layout: without it an
 * overflowing line spills BELOW the header's background, and because the grid
 * scrolls underneath a sticky header, event blocks then render straight through
 * it. That is exactly what happened — "8:30 AM - 9:40 AM" printed on top of
 * "26% booked". Clipping keeps a future copy change from reintroducing it.
 */
const HEADER_STACK =
  // `[&>button]:py-0` reclaims the shared trigger's 8px of vertical padding.
  // The cell is a fixed 96px and the trigger alone is 88px, so stacking a 10px
  // utilisation line under it overflowed by ~5px — and `overflow-hidden` then
  // clipped the very number the line exists to show. Dropping that padding
  // brings the stack to ~92px, which fits with room to spare. The trigger is
  // passed in as `children`, so this targets it from the parent rather than
  // reaching into a component we don't own.
  'flex h-full flex-col items-center justify-center gap-0.5 overflow-hidden px-1 [&>button]:py-0';

function UtilisationLabel({
  value,
  retired,
}: {
  value: { utilisation: number; openMinutes: number } | undefined;
  retired?: boolean;
}) {
  // OPEN ZERO MINUTES IS NOT ZERO PER CENT.
  //
  // `utilisation` is `bookedMinutes / openMinutes`, and the service floors it
  // to exactly 0 when `openMinutes` is 0 — a divide-by-zero GUARD, not an
  // answer. Rendering that as "0% booked" states something false: on a day the
  // branch is closed a room can still hold a booking, and the header then
  // reports it as unused. "Undefined" and "unused" are different facts and must
  // not look identical.
  //
  // Seen on the seeded demo: a room with a one-hour booking on a Sunday, when
  // the branch is closed, showing "0% booked".
  if (value !== undefined && value.openMinutes === 0) {
    return (
      <span className="whitespace-nowrap text-[10px] leading-none text-muted-foreground">
        Closed
      </span>
    );
  }

  if (value === undefined) {
    return (
      <span className="whitespace-nowrap text-[10px] leading-none text-muted-foreground">
        {/* A deactivated room has no utilisation to report BECAUSE it is
            retired — "No data" reads like a loading failure. */}
        {retired ? 'Retired' : 'No data'}
      </span>
    );
  }
  return (
    <span
      data-utilisation
      className={cn(
        'whitespace-nowrap text-[10px] leading-none font-medium tabular-nums text-muted-foreground',
        value.utilisation >= UTILISATION_TARGET &&
          'text-green-600 dark:text-green-400'
      )}
    >
      {Math.round(value.utilisation * 100)}% booked
    </span>
  );
}

/**
 * The rooms calendar's `config.staffHeaderMenu`.
 *
 * The library renders this around the column header's avatar + name — the only
 * hook a host has into that cell — and draws a chevron on it, so it has to be a
 * real menu. The grid's own trigger is rendered untouched as `children`; the
 * room's colour dot and utilisation sit beneath it, and the popover carries the
 * details that don't fit a column head.
 *
 * Utilisation is shown against the 75–85% band clinics actually target, so an
 * under-used room is legible at a glance rather than needing the report.
 */
export function RoomsColumnHeader({ staff, children }: RoomsColumnHeaderProps) {
  const routes = useBranchRoutes();
  const rooms = useRoomsCalendar();
  const selectedKind =
    rooms?.categories.find(
      (category) => category.id === rooms.selectedCategoryId
    )?.kind ?? 'room';
  const nounLower =
    resourceCategoryKindSingularLabels[selectedKind].toLowerCase();

  if (staff.id === UNASSIGNED_ROOM_ID) {
    return (
      <Popover>
        <div className={HEADER_STACK}>
          <PopoverTrigger asChild>{children}</PopoverTrigger>
          <span className="text-[10px] leading-none text-muted-foreground">
            {/* The lane exists on the equipment axis too, where "No room" is
                simply the wrong noun. */}
            No {nounLower}
          </span>
        </div>
        <PopoverContent align="center" className="w-64 text-sm">
          <p className="font-medium">Unassigned</p>
          <p className="mt-1 text-muted-foreground">
            Bookings in this window that hold no {nounLower} in this category.
            Drag one into a {nounLower} column to assign it.
          </p>
        </PopoverContent>
      </Popover>
    );
  }

  const resource = rooms?.resourceById.get(staff.id);
  const utilisation = rooms?.utilisationByResourceId.get(staff.id);
  const specs = Object.entries(resource?.specs ?? {});

  return (
    <Popover>
      <div className={HEADER_STACK}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        {/* No colour dot here. It rendered only for rooms that HAD a colour,
            so a column with one sat beside columns without — and it is
            redundant now that the header avatar IS the room's colour chip.
            It also cost ~14px in the 96px week rail, which is what pushed
            "26% booked" onto a second line. */}
        <UtilisationLabel
          value={utilisation}
          retired={resource ? !resource.isActive : false}
        />
      </div>

      <PopoverContent align="center" className="w-64">
        <div className="flex items-center gap-2">
          <DoorOpen className="size-4 shrink-0 text-muted-foreground" />
          <p className="truncate font-medium">{staff.name}</p>
        </div>

        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Booked today</dt>
            <dd>
              <UtilisationLabel value={utilisation} />
            </dd>
          </div>
          {resource && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Capacity</dt>
              <dd className="tabular-nums">{resource.capacity}</dd>
            </div>
          )}
          {resource && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Hours</dt>
              <dd>{resource.workingHours ? 'Custom' : 'Always open'}</dd>
            </div>
          )}
          {specs.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <dt className="truncate text-muted-foreground">{key}</dt>
              <dd className="truncate">{value}</dd>
            </div>
          ))}
        </dl>

        <Button asChild variant="outline" size="sm" className="mt-3 w-full">
          <Link to={routes.catalogResources}>
            <Settings2 />
            Edit rooms
          </Link>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
