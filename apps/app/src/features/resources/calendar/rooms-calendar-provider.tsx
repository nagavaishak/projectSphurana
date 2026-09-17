import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { CalendarProvider, useCalendar } from '@/components/calendar';
import type { ICalendarConfig, IEvent, IUser } from '@/components/calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { useListAppointments } from '@/features/appointments';
import { useActiveOrganization } from '@/features/organization';
import {
  useListResourceCategories,
  useListResources,
  useResourceAllocations,
  useResourceUtilisation,
} from '@/features/resources';
import { AddBlockedTimeDialog } from '@/features/scheduling';
import { useBranchRoutes } from '@/lib/use-routes';
import type {
  Resource,
  ResourceCategory,
} from '@borradh-workspace/api-client/types';
import { resourceCategoryKindLabels } from '@borradh-workspace/api-client/types';

import { EventRoomsDetail } from './event-rooms-detail';
import { RoomsAxisToggle } from './rooms-axis-toggle';
import { RoomsCalendarContextProvider } from './rooms-calendar-context';
import {
  buildRoomsEvents,
  resourceShiftsForRange,
  roomsCalendarUsers,
  roomsEventFilter,
  roomsMetadata,
} from './rooms-calendar-model';
import { RoomsColumnHeader } from './rooms-column-header';
import { takePendingRoomDrop } from './rooms-drop-registry';
import { RoomsEmptyState } from './rooms-empty-state';
import { RoomsEventDetails } from './rooms-event-details';
import { RoomsHeaderActions } from './rooms-header-actions';
import { RoomsSlot } from './rooms-slot';
import { useRoomsReassign } from './use-rooms-reassign';

/**
 * The window the calendar fetches for. Matches the bookings calendar: a whole
 * month padded to week boundaries, which covers every view (day through month)
 * without refetching as you step within it.
 */
/** Everything that decides WHERE and HOW a block is drawn. */
function roomsEventSignature(event: IEvent | undefined): string {
  if (!event) return '';
  const rooms = roomsMetadata(event);
  return [
    event.id,
    event.startDate,
    event.endDate,
    event.color,
    event.title,
    rooms?.resourceIds.join(',') ?? '',
    rooms?.allowOverlap ? '1' : '0',
    rooms?.turnaroundMinutes ?? 0,
  ].join('|');
}

function windowFor(selectedDate: Date) {
  return {
    start: startOfWeek(startOfMonth(selectedDate)),
    end: endOfWeek(endOfMonth(selectedDate)),
  };
}

/** The category a clinic means by "the calendar" unless it says otherwise. */
function defaultCategoryId(categories: ResourceCategory[]): string {
  const room = categories.find((category) => category.kind === 'room');
  return (room ?? categories[0])?.id ?? '';
}

interface SyncProps {
  children: React.ReactNode;
  categories: ResourceCategory[];
  selectedCategoryId: string;
  setSelectedCategoryId: (categoryId: string) => void;
  resources: Resource[];
  resourceById: Map<string, Resource>;
}

/**
 * Keeps the calendar context fed as the user pages through dates.
 *
 * Lives INSIDE `CalendarProvider` because the window is derived from
 * `selectedDate`, which the shared context owns.
 */
function RoomsCalendarSync({
  children,
  categories,
  selectedCategoryId,
  setSelectedCategoryId,
  resources,
  resourceById,
}: SyncProps) {
  const { selectedDate, setLocalEvents, setResolvedShifts } = useCalendar();

  const range = useMemo(() => windowFor(selectedDate), [selectedDate]);

  const { allocations } = useResourceAllocations({
    from: range.start.toISOString(),
    to: range.end.toISOString(),
  });

  const { appointments } = useListAppointments({
    startDateFrom: range.start,
    startDateTo: range.end,
    limit: 500,
  });

  // Utilisation for the day in view. The report is per-day, so a week/month
  // view shows the selected day's figure rather than an average that would
  // silently mean something different in each view.
  const { rows: utilisationRows } = useResourceUtilisation({
    from: format(selectedDate, 'yyyy-MM-dd'),
    to: format(addDays(selectedDate, 1), 'yyyy-MM-dd'),
  });

  const utilisationByResourceId = useMemo(() => {
    const map = new Map<string, { utilisation: number; openMinutes: number }>();
    for (const row of utilisationRows)
      map.set(row.resourceId, {
        utilisation: row.utilisation,
        openMinutes: row.openMinutes,
      });
    return map;
  }, [utilisationRows]);

  useEffect(() => {
    const days = eachDayOfInterval({ start: range.start, end: range.end });
    setResolvedShifts(resourceShiftsForRange(resources, days));
  }, [resources, range.start, range.end, setResolvedShifts]);

  useEffect(() => {
    const events = buildRoomsEvents({
      allocations,
      appointments,
      resources,
      categoryId: selectedCategoryId,
    });
    // Functional update with an id bail-out: `allocations`/`appointments` are
    // fresh arrays on every render while a query is pending, and writing an
    // equal-but-new array back into context re-renders the whole grid forever.
    //
    // The bail-out compares a SIGNATURE, not just ids. An allocation keeps its
    // id when it moves room (PUT /appointments/:id/resources patches the row
    // in place), so an id-only check kept the stale block in its old column
    // after every drag, side-panel change and force — until a full reload.
    setLocalEvents((prev) => {
      if (
        prev.length === events.length &&
        prev.every(
          (event, index) =>
            roomsEventSignature(event) ===
            roomsEventSignature(events[index] as IEvent)
        )
      ) {
        return prev;
      }
      return events;
    });
  }, [
    allocations,
    appointments,
    resources,
    selectedCategoryId,
    setLocalEvents,
  ]);

  const contextValue = useMemo(
    () => ({
      categories,
      selectedCategoryId,
      setSelectedCategoryId,
      resourceById,
      utilisationByResourceId,
    }),
    [
      categories,
      selectedCategoryId,
      setSelectedCategoryId,
      resourceById,
      utilisationByResourceId,
    ]
  );

  return (
    <RoomsCalendarContextProvider value={contextValue}>
      {children}
    </RoomsCalendarContextProvider>
  );
}

interface RoomsCalendarProviderProps {
  children: React.ReactNode;
  /**
   * Small-screen header, supplied by the route because the bookings header it
   * wraps lives there (`features → routes` is the import direction that caused
   * the circular import this feature already fixed once).
   */
  mobileHeader?: ICalendarConfig['mobileHeader'];
}

/**
 * ROOMS CALENDAR.
 *
 * Rooms are a PROVIDER CONFIG, not a second calendar. The shared day / 3-day /
 * week grids are already generic over their column entity — they resolve column
 * membership through `config.eventFilter` (see `use-column-matcher.ts`), which
 * is exactly how the content planner drives the same grids with social pages.
 * So every view behaves identically to the staff axis for free:
 *
 *   day    → one time-grid column per selected room
 *   3day   → one room  → avatar + times + a column per day
 *            many rooms → rooms become ROWS, days are COLUMNS
 *   week   → the same component at dayCount=7
 *
 * `month` / `year` / `agenda` are unchanged: there rooms are a filter, not an
 * axis. Not one shared calendar component was modified to get here.
 */
export function RoomsCalendarProvider({
  children,
  mobileHeader,
}: RoomsCalendarProviderProps) {
  const routes = useBranchRoutes();

  const { data: organization, isLoading: isOrgLoading } =
    useActiveOrganization();

  const { categories, isLoading: isCategoriesLoading } =
    useListResourceCategories();

  const activeCategories = useMemo(
    () => categories.filter((category) => category.isActive),
    [categories]
  );

  const [chosenCategoryId, setChosenCategoryId] = useState<string | null>(null);
  const selectedCategoryId =
    chosenCategoryId && activeCategories.some((c) => c.id === chosenCategoryId)
      ? chosenCategoryId
      : defaultCategoryId(activeCategories);

  // `includeInactive` on purpose. A deactivated room keeps whatever bookings
  // it already had, and the allocations feed returns them — so without this
  // the calendar renders holds for a lane that does not exist, and those
  // bookings are invisible AND unmovable. Deactivating a room must not strand
  // the appointments in it; it must make them the obvious thing to rescue.
  //
  // The lane is labelled "retired" in the column header so it cannot be
  // mistaken for somewhere new bookings can go — the reassign endpoint
  // refuses an inactive target, and a lane that silently rejected every drop
  // would be worse than no lane at all.
  const { resources: allResources, isLoading: isResourcesLoading } =
    useListResources(
      selectedCategoryId
        ? { categoryId: selectedCategoryId, includeInactive: true }
        : { includeInactive: true }
    );

  const resources = allResources;

  const resourceById = useMemo(
    () => new Map(resources.map((resource) => [resource.id, resource])),
    [resources]
  );

  const users: IUser[] = useMemo(
    () => roomsCalendarUsers(resources),
    [resources]
  );

  const { dropOnRoom } = useRoomsReassign(resourceById);

  /**
   * Drag-to-reassign.
   *
   * The shared `DroppableTimeBlock` handles the drop and then asks the host to
   * confirm before it applies a time change. By then the innermost
   * room-scoped target (`RoomsSlot`) has already recorded WHICH column the
   * block landed on, so this is where the two halves meet.
   *
   * Always answers `confirmed: false`: this calendar reassigns rooms, it does
   * not reschedule. Letting the drop also move the appointment in time would
   * make a sideways drag silently rewrite the client's booking, and the
   * bookings calendar already owns rescheduling (with its notify-the-client
   * confirmation). The reassignment itself is optimistic in the mutation, so
   * the block still follows the cursor into its new column.
   */
  const handleConfirmDrop = useCallback(
    ({ originalEvent }: { originalEvent: IEvent; updatedEvent: IEvent }) => {
      dropOnRoom(originalEvent, takePendingRoomDrop());
      return Promise.resolve({ confirmed: false });
    },
    [dropOnRoom]
  );

  const selectedCategory = activeCategories.find(
    (category) => category.id === selectedCategoryId
  );
  const kindLabel = (
    resourceCategoryKindLabels[selectedCategory?.kind ?? 'room'] ?? 'Rooms'
  ).toLowerCase();

  const config: Partial<ICalendarConfig> = useMemo(
    () => ({
      mode: 'appointments' as const,
      labels: {
        // Same nouns as the staff calendar: switching axis must not rename
        // the thing you are creating.
        addButton: 'Add Appointment',
        dialogTitle: 'Add New Appointment',
        emptyState: `No appointments in these ${kindLabel}`,
        eventLabel: 'Appointment',
        eventLabelPlural: 'Appointments',
      },
      // Column-per-resource layout: day view columns, and the 3-day/week
      // resource×days grid (rooms on rows when more than one is selected).
      dayColumnsPerStaff: true,
      // Not a dialog — the per-slot room-scoped drop target. See RoomsSlot,
      // which also serves the toolbar's controlled "Add" dropdown.
      customAddDialog: RoomsSlot,
      // The SAME Add menu the staff calendar has. Blocked time, a sale and a
      // quick payment are org-level actions a front desk reaches for from
      // whichever calendar happens to be on screen; making them disappear
      // because you switched axis is just a worse toolbar. Declaring the
      // secondary dialog is also what promotes the single button back to the
      // full dropdown — `useDirectAddButton` keys off exactly this.
      secondaryAddDialog: AddBlockedTimeDialog,
      customEventDetailsDialog: RoomsEventDetails,
      // Click a booking → see and change its room.
      eventDetailsExtra: EventRoomsDetail,
      staffHeaderMenu: RoomsColumnHeader,
      eventFilter: roomsEventFilter,
      resourceSelect: {
        allLabel: `All ${kindLabel}`,
        searchPlaceholder: `Search ${kindLabel}`,
        countNoun: kindLabel,
      },
      onConfirmDrop: handleConfirmDrop,
      headerActions: <RoomsHeaderActions />,
      // Immediately after the "All rooms" picker, which is the same question
      // it answers: which rows am I looking at.
      headerAxisToggle: <RoomsAxisToggle axis="rooms" />,
      routerBasePath: routes.calendarRooms,
      navigateToDayOnMonthCellClick: true,
      mobileHeader,
    }),
    [handleConfirmDrop, kindLabel, mobileHeader, routes]
  );

  if (isOrgLoading || isCategoriesLoading || isResourcesLoading) {
    return (
      <div className="flex h-full flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-48" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  if (!selectedCategoryId || resources.length === 0) {
    return <RoomsEmptyState />;
  }

  return (
    <CalendarProvider
      users={users}
      events={[]}
      config={config}
      timeZone={organization?.timezone ?? 'UTC'}
    >
      <RoomsCalendarSync
        categories={activeCategories}
        selectedCategoryId={selectedCategoryId}
        setSelectedCategoryId={setChosenCategoryId}
        resources={resources}
        resourceById={resourceById}
      >
        {children}
      </RoomsCalendarSync>
    </CalendarProvider>
  );
}
