import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import type {
  ICalendarConfig,
  ICalendarLocation,
  IEvent,
  IUser,
} from '@/components/calendar/interfaces';
import type {
  TBadgeVariant,
  TResolvedShift,
  TVisibleHours,
  TWorkingHours,
} from '@/components/calendar/types';
import type { Dispatch, SetStateAction } from 'react';

interface ICalendarContext {
  config: ICalendarConfig;
  /**
   * IANA timezone the business operates in (organization.timezone). All event
   * times are UTC instants; the calendar renders and creates times in this
   * zone so they don't shift with the viewer's device timezone.
   */
  timeZone: string;
  selectedDate: Date;
  setSelectedDate: (date: Date | undefined) => void;
  /**
   * Multi-select source of truth for which staff columns are visible.
   * `'all'` sentinel = every team member (also the default). Otherwise an
   * explicit list of practitioner ids.
   */
  selectedUserIds: string[] | 'all';
  setSelectedUserIds: (value: string[] | 'all') => void;
  /**
   * Derived single-select value kept for legacy consumers (week view add-slot
   * prefill, mobile view-options sheet): `'all'` unless exactly one member is
   * selected, in which case that member's id.
   */
  selectedUserId: IUser['id'] | 'all';
  setSelectedUserId: (userId: IUser['id'] | 'all') => void;
  selectedServiceId: string | 'all';
  setSelectedServiceId: (serviceId: string | 'all') => void;
  /**
   * The location whose opening hours drive closed-time blocks and whose
   * appointments are shown. Owned by the sidebar's LocationSwitcher — the
   * calendar has no picker of its own, so there is no setter here.
   */
  selectedLocationId: string | null;
  /** Date for which the edit-opening-hours dialog is open; null = closed. */
  editOpeningHoursDate: Date | null;
  setEditOpeningHoursDate: (date: Date | null) => void;
  badgeVariant: TBadgeVariant;
  setBadgeVariant: (variant: TBadgeVariant) => void;
  users: IUser[];
  locations: ICalendarLocation[];
  workingHours: TWorkingHours;
  setWorkingHours: Dispatch<SetStateAction<TWorkingHours>>;
  /**
   * Per-practitioner resolved shifts for the visible range. Drives the
   * off-shift diagonal hatch in the day/week grids. Empty = fall back to
   * location working hours.
   */
  resolvedShifts: TResolvedShift[];
  setResolvedShifts: Dispatch<SetStateAction<TResolvedShift[]>>;
  visibleHours: TVisibleHours;
  setVisibleHours: Dispatch<SetStateAction<TVisibleHours>>;
  events: IEvent[];
  setLocalEvents: Dispatch<SetStateAction<IEvent[]>>;
}

const CalendarContext = createContext({} as ICalendarContext);

const WORKING_HOURS = {
  0: { from: 0, to: 0 },
  1: { from: 8, to: 17 },
  2: { from: 8, to: 17 },
  3: { from: 8, to: 17 },
  4: { from: 8, to: 17 },
  5: { from: 8, to: 17 },
  6: { from: 8, to: 12 },
};

const VISIBLE_HOURS = { from: 0, to: 24 };

// Default appointments config
const DEFAULT_CONFIG: ICalendarConfig = {
  mode: 'appointments',
  labels: {
    addButton: 'Add Event',
    dialogTitle: 'Add New Event',
    emptyState: 'No events scheduled',
    eventLabel: 'Event',
    eventLabelPlural: 'Events',
  },
};

interface CalendarProviderProps {
  children: React.ReactNode;
  users: IUser[];
  events: IEvent[];
  config?: Partial<ICalendarConfig>;
  locations?: ICalendarLocation[];
  /**
   * Working hours sourced from the selected location's effective schedule.
   * If omitted, falls back to the local WORKING_HOURS default.
   */
  workingHours?: TWorkingHours;
  /** Initial per-practitioner resolved shifts (kept in sync by the wrapper). */
  resolvedShifts?: TResolvedShift[];
  /**
   * The active location, from the sidebar's LocationSwitcher. Changes here
   * re-point the calendar; a null value falls back to the primary location.
   */
  locationId?: string | null;
  /** IANA business timezone (organization.timezone). Defaults to UTC. */
  timeZone?: string;
  /**
   * Day to open on. Seeds `selectedDate` instead of "today".
   *
   * The calendar previously always started on `new Date()`, so `?date=` in the
   * URL was accepted by the router and then ignored — a link to a specific day,
   * shared with a colleague or bookmarked, silently landed them on today. Only
   * the INITIAL value: once the calendar is open the arrows and the date picker
   * own the state, and re-seeding on every render would fight them.
   */
  initialDate?: Date;
}

export function CalendarProvider({
  children,
  users,
  events,
  config: userConfig,
  locations: providedLocations,
  workingHours: providedWorkingHours,
  resolvedShifts: providedResolvedShifts,
  locationId,
  timeZone = 'UTC',
  initialDate,
}: CalendarProviderProps) {
  // Merge user config with defaults
  const config: ICalendarConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    labels: {
      ...DEFAULT_CONFIG.labels,
      ...userConfig?.labels,
    },
  };

  const [badgeVariant, setBadgeVariant] = useState<TBadgeVariant>('colored');
  const [visibleHours, setVisibleHours] =
    useState<TVisibleHours>(VISIBLE_HOURS);
  const [workingHours, setWorkingHours] = useState<TWorkingHours>(
    providedWorkingHours ?? WORKING_HOURS
  );
  const [resolvedShifts, setResolvedShifts] = useState<TResolvedShift[]>(
    providedResolvedShifts ?? []
  );

  // Sync workingHours when the parent provider hands down new hours
  // (e.g. when the selected location changes or its schedule is edited).
  useEffect(() => {
    if (providedWorkingHours) setWorkingHours(providedWorkingHours);
  }, [providedWorkingHours]);

  const [selectedDate, setSelectedDate] = useState(initialDate ?? new Date());
  const [selectedUserIds, setSelectedUserIds] = useState<string[] | 'all'>(
    'all'
  );

  // Derive the legacy single-select value from the multi-select set.
  const selectedUserId: IUser['id'] | 'all' = useMemo(() => {
    if (selectedUserIds === 'all') return 'all';
    if (selectedUserIds.length === 1) return selectedUserIds[0];
    return 'all';
  }, [selectedUserIds]);

  const setSelectedUserId = (userId: IUser['id'] | 'all') =>
    setSelectedUserIds(userId === 'all' ? 'all' : [userId]);
  const [selectedServiceId, setSelectedServiceId] = useState<string | 'all'>(
    'all'
  );
  const [editOpeningHoursDate, setEditOpeningHoursDate] = useState<Date | null>(
    null
  );

  // Derived, not state: the choice lives in the sidebar. Falling back to the
  // primary (or first) location keeps closed-hour blocks rendering for embeds
  // that pass no location at all, e.g. the content planner.
  const selectedLocationId = useMemo(() => {
    if (locationId) return locationId;
    if (!providedLocations?.length) return null;
    const primary =
      providedLocations.find((l) => l.isPrimary) ?? providedLocations[0];
    return primary?.id ?? null;
  }, [locationId, providedLocations]);

  const [localEvents, setLocalEvents] = useState<IEvent[]>(events);

  const handleSelectDate = (date: Date | undefined) => {
    if (!date) return;
    setSelectedDate(date);
  };

  return (
    <CalendarContext.Provider
      value={{
        config,
        timeZone,
        selectedDate,
        setSelectedDate: handleSelectDate,
        selectedUserIds,
        setSelectedUserIds,
        selectedUserId,
        setSelectedUserId,
        selectedServiceId,
        setSelectedServiceId,
        selectedLocationId,
        editOpeningHoursDate,
        setEditOpeningHoursDate,
        badgeVariant,
        setBadgeVariant,
        users,
        locations: providedLocations ?? [],
        visibleHours,
        setVisibleHours,
        workingHours,
        setWorkingHours,
        resolvedShifts,
        setResolvedShifts,
        events: localEvents,
        setLocalEvents,
      }}
    >
      {children}
    </CalendarContext.Provider>
  );
}

/**
 * The calendar context if there is one, else null.
 *
 * For consumers that are USUALLY inside a calendar but must not require it —
 * the create-appointment dialog is rendered by the calendar in the app and
 * standalone in its tests, and a throwing hook would make "which location is
 * this booking at" impossible to ask without breaking the second case.
 */
export function useOptionalCalendar(): ICalendarContext | null {
  return useContext(CalendarContext) ?? null;
}

export function useCalendar(): ICalendarContext {
  const context = useContext(CalendarContext);
  if (!context)
    throw new Error('useCalendar must be used within a CalendarProvider.');
  return context;
}
