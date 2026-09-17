import { useDrop } from 'react-dnd';

import { ResponsiveAddDialog } from '@/routes/_authed/dashboard/l/$locationId/calendar/-components/mobile/responsive-add-dialog';

import { ItemTypes } from '@/components/calendar/components/dnd/draggable-event';

import { UNASSIGNED_ROOM_ID } from './rooms-calendar-model';
import { setPendingRoomDrop } from './rooms-drop-registry';

interface RoomsSlotProps {
  startDate?: Date;
  startTime?: { hour: number; minute: number };
  children?: React.ReactNode;
  /**
   * The column's id. The grids pass their column entity through as
   * `practitionerId`; on this calendar that IS the resource id (or the
   * Unassigned column's sentinel).
   */
  practitionerId?: string;
  /** Controlled open — set when the header "Add" menu drives this directly. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * The rooms calendar's `config.customAddDialog`.
 *
 * It is NOT a dialog. The grids render `config.customAddDialog` inside every
 * empty time slot and hand it the column's id, which makes it the only place a
 * component we own can learn which resource column a point of the grid belongs
 * to. So it does two jobs and no more:
 *
 *  1. Registers a nested react-dnd drop target for `ItemTypes.EVENT` — the same
 *     item the shared `DraggableEvent` emits. react-dnd drops innermost-first,
 *     so this records the target column before the enclosing
 *     `DroppableTimeBlock` runs and hands control to `config.onConfirmDrop`.
 *  2. Renders the grid's hover affordance untouched.
 *
 * Falling back to the library default (`AddEventDialog`) would both lose the
 * column signal and offer a generic "add event" form that writes nothing this
 * calendar owns — bookings are created from the bookings calendar.
 *
 * `display: contents` is deliberate: the child hover slot is absolutely
 * positioned against the HOUR cell, so this wrapper must not generate a box.
 * DOM events still bubble through a `contents` element, which is all react-dnd
 * needs.
 */
export function RoomsSlot({
  children,
  practitionerId,
  startDate,
  startTime,
  open,
  onOpenChange,
}: RoomsSlotProps) {
  // ⚠️ THE GUARD MUST PRECEDE THE HOOK, which is why this is split in two.
  //
  // `ClientContainer` renders `config.customAddDialog` in TWO places: inside
  // the grid (within `DndProviderWrapper`) and in the HEADER, which sits
  // OUTSIDE it. `useDrop` throws "Expected drag drop context" with no provider
  // above it, and a hook cannot be called conditionally — so an early return
  // placed AFTER `useDrop` does not save us. It crashed the whole rooms
  // calendar into its error boundary.
  //
  // A unit test does NOT catch this: the harness wraps everything in its own
  // `DndProvider`, so the header path has a context there that it lacks in the
  // real route. Found by driving the actual page in a browser.
  //
  // The header render must still produce the ADD DIALOG, in BOTH shapes the
  // toolbar uses it in: as a wrapper around a trigger, and CONTROLLED by the
  // "Add" dropdown (`open` / `onOpenChange`, no children). Returning null here
  // fixed the crash and took the toolbar's primary action with it.
  //
  // There is no column to preselect from a toolbar button, which is exactly
  // right: the booking opens with its room Unassigned and the operator picks
  // one, the same as booking from the staff calendar.
  if (!practitionerId) {
    return (
      <ResponsiveAddDialog
        startDate={startDate}
        startTime={startTime}
        open={open}
        onOpenChange={onOpenChange}
      >
        {children}
      </ResponsiveAddDialog>
    );
  }

  return (
    <RoomsDropSlot
      practitionerId={practitionerId}
      startDate={startDate}
      startTime={startTime}
    >
      {children}
    </RoomsDropSlot>
  );
}

/**
 * The real slot: a drop target for reassignment AND the create affordance.
 *
 * `practitionerId` is the library's name for "the column this slot is in"; on
 * this calendar that column is a ROOM. It is deliberately NOT forwarded as the
 * new booking's practitioner — that would assign a person from a room id.
 * It goes to `preselectedResourceId`, so booking into a column lands in that
 * column and the operator still picks who is doing it.
 */
function RoomsDropSlot({
  children,
  practitionerId,
  startDate,
  startTime,
}: {
  children?: React.ReactNode;
  practitionerId: string;
  startDate?: Date;
  startTime?: { hour: number; minute: number };
}) {
  const [, drop] = useDrop(
    () => ({
      accept: ItemTypes.EVENT,
      // No drop result: the enclosing DroppableTimeBlock must still run.
      drop: () => {
        setPendingRoomDrop(practitionerId);
      },
    }),
    [practitionerId]
  );

  // The Unassigned column is the absence of a room, so there is nothing to
  // preselect and nothing to create INTO — it stays drop-only.
  const isUnassigned = practitionerId === UNASSIGNED_ROOM_ID;

  const slot = (
    <div
      ref={drop as unknown as React.RefObject<HTMLDivElement>}
      className="contents"
      data-rooms-slot={practitionerId}
    >
      {children}
    </div>
  );

  if (isUnassigned) return slot;

  return (
    <ResponsiveAddDialog
      startDate={startDate}
      startTime={startTime}
      preselectedResourceId={practitionerId}
    >
      {slot}
    </ResponsiveAddDialog>
  );
}
