import { endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EventRoomsDetail } from '@/features/resources/calendar/event-rooms-detail';
import { StaffAxisToggleSlot } from '@/features/resources/calendar/staff-axis-toggle-slot';

import {
  APPOINTMENTS_CONFIG,
  CalendarProvider,
  eventBelongsToPractitioner,
  useCalendar,
} from '@/components/calendar';
import type {
  ICalendarConfig,
  ICalendarLocation,
  IEvent,
  IUser,
  TResolvedShift,
} from '@/components/calendar';
import { EditOpeningHoursDialog } from '@/components/calendar/components/dialogs/edit-opening-hours-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type AppointmentWithRelations,
  updateIntentFromCalendarEvent,
  useDeleteAppointment,
  useListAppointments,
  useUpdateAppointment,
} from '@/features/appointments';
import {
  resolveDateOpening,
  scheduleToWorkingHours,
  useGetLocationSchedule,
} from '@/features/location-opening-hours';
import {
  useActiveOrganization,
  useGetOrganizationMembers,
} from '@/features/organization';
import {
  useActiveLocation,
  useListLocations,
} from '@/features/organization-locations';
import { useListPractitioners } from '@/features/practitioners';
import {
  AddBlockedTimeDialog,
  type BlockedTimeWithPractitioners,
  EditBlockedTimeDialog,
  type ResolvedShiftDay,
  useDeleteBlockedTime,
  useListBlockedTime,
  useListShifts,
  useUpdateBlockedTime,
} from '@/features/scheduling';
import {
  formatLeadName,
  resolveServiceName,
} from './appointment-event-display';
import { MobileBookingsHeader } from './mobile/mobile-bookings-header';
import { ResponsiveAddDialog } from './mobile/responsive-add-dialog';
import { ResponsiveEventDetailsDialog } from './mobile/responsive-event-details-dialog';
import { RescheduleConfirmDialog } from './reschedule-confirm-dialog';
import { StaffHeaderMenu } from './staff-header-menu';

/**
 * Convert Appointment (API) to IEvent (Calendar)
 */
function appointmentToEvent(
  appointment: AppointmentWithRelations,
  members: Array<{
    user: { id: string; name: string; image: string | null };
  }>,
  practitionerColorById: Map<string, IEvent['color'] | null | undefined>,
  practitionerNameById: Map<string, string>
): IEvent {
  const member = members.find((m) => m.user.id === appointment.assignedToId);
  // Prefer the assigned practitioner's org-scoped color when set; fall back
  // to the per-appointment color column.
  const practitionerColor = appointment.practitionerId
    ? (practitionerColorById.get(appointment.practitionerId) ?? null)
    : null;
  const resolvedColor =
    practitionerColor ?? (appointment.color as IEvent['color']);
  const leadName = formatLeadName(appointment.lead);
  const staffMemberName = appointment.practitionerId
    ? practitionerNameById.get(appointment.practitionerId)
    : undefined;

  return {
    id: appointment.id,
    title: appointment.title,
    description: appointment.description || '',
    startDate: appointment.startDate,
    endDate: appointment.endDate,
    color: resolvedColor,
    user: {
      // assignedToId is nullable (set null when the assigned user is deleted).
      id: appointment.assignedToId ?? '',
      name: member?.user.name || 'Unassigned',
      picturePath: member?.user.image || null,
      color: practitionerColor,
    },
    metadata: {
      practitionerId: appointment.practitionerId,
      serviceId: appointment.serviceId ?? null,
      leadName,
      staffMemberName,
      serviceName: resolveServiceName({
        title: appointment.title,
        leadName,
        lead: appointment.lead,
      }),
      status: appointment.status,
      deposit: appointment.deposit ?? null,
    },
  };
}

/**
 * Convert an expanded blocked-time occurrence to an IEvent. Tagged with
 * `metadata.type === 'blocked-time'` so the calendar renders it as a solid
 * grey block, matches it into the right practitioner columns, routes
 * update/delete through the blocked-time API, and hands the edit dialog the
 * fields it needs (see `blockedTimeTargetFromEvent`).
 */
function blockedTimeToEvent(
  blockedTime: BlockedTimeWithPractitioners,
  users: IUser[]
): IEvent {
  const [firstPractitionerId] = blockedTime.practitionerIds;
  const practitioner = firstPractitionerId
    ? users.find((u) => u.id === firstPractitionerId)
    : undefined;
  return {
    id: blockedTime.id,
    title: blockedTime.title,
    description: blockedTime.description || '',
    startDate: blockedTime.startDate,
    endDate: blockedTime.endDate,
    color: 'gray',
    user: {
      id: firstPractitionerId ?? 'all',
      name: practitioner?.name ?? 'Whole team',
      picturePath: practitioner?.picturePath ?? null,
      color: practitioner?.color ?? null,
    },
    metadata: {
      type: 'blocked-time',
      // Series id (occurrence ids look like `${seriesId}:${originalStart}`).
      blockedTimeId: blockedTime.blockedTimeId ?? String(blockedTime.id),
      practitionerIds: blockedTime.practitionerIds,
      originalStart: blockedTime.originalStart ?? null,
      rrule: blockedTime.rrule,
      recurrenceEndDate: blockedTime.recurrenceEndDate,
      blockedTimeTypeId: blockedTime.blockedTimeTypeId,
      paid: blockedTime.paid,
      allDay: blockedTime.allDay,
    },
  };
}

/**
 * Map a resolved shift day (scheduling API) onto the calendar's decoupled
 * shift shape. Drives the off-shift diagonal hatch per practitioner column.
 */
function toCalendarShift(day: ResolvedShiftDay): TResolvedShift {
  return {
    practitionerId: day.practitionerId,
    date: day.date,
    isOff: day.isOff,
    intervals: day.intervals.map((i) => ({
      startMinutes: i.startMinutes,
      endMinutes: i.endMinutes,
    })),
  };
}

interface AppointmentsProviderInnerProps {
  children: React.ReactNode;
}

/**
 * Inner component that syncs external data with CalendarProvider state
 */
function AppointmentsSyncWrapper({ children }: AppointmentsProviderInnerProps) {
  const {
    selectedDate,
    setLocalEvents,
    users,
    selectedLocationId,
    setWorkingHours,
    setResolvedShifts,
    editOpeningHoursDate,
    setEditOpeningHoursDate,
  } = useCalendar();

  // Calculate date range for fetching (extended to cover month view with week overlap)
  const dateRange = useMemo(() => {
    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(selectedDate);
    return {
      start: startOfWeek(monthStart),
      end: endOfWeek(monthEnd),
    };
  }, [selectedDate]);

  const { data: organization } = useActiveOrganization();
  const organizationId = organization?.id || '';

  // Fetch members for user display
  const { members } = useGetOrganizationMembers(organizationId);

  // Fetch appointments for the date range
  const { appointments } = useListAppointments({
    startDateFrom: dateRange.start,
    startDateTo: dateRange.end,
    limit: 500,
  });

  // Fetch blocked-time occurrences for the date range
  const { blockedTimes } = useListBlockedTime({
    from: dateRange.start.toISOString(),
    to: dateRange.end.toISOString(),
  });

  // Fetch resolved shifts for the range and drive the off-shift hatch.
  const { shiftDays } = useListShifts({
    from: dateRange.start.toISOString(),
    to: dateRange.end.toISOString(),
  });

  useEffect(() => {
    setResolvedShifts(shiftDays.map(toCalendarShift));
  }, [shiftDays, setResolvedShifts]);

  // Fetch the selected location's opening-hours schedule and drive
  // workingHours from it. The week/day views read workingHours to render
  // closed-hour stripes.
  const { schedule } = useGetLocationSchedule({
    locationId: selectedLocationId,
    windowStart: dateRange.start.toISOString(),
    windowEnd: dateRange.end.toISOString(),
  });

  useEffect(() => {
    setWorkingHours(scheduleToWorkingHours(schedule));
  }, [schedule, setWorkingHours]);

  // Lookup: practitionerId → color (rebuilt from the calendar's users so
  // tinting always tracks the latest practitioner list).
  const practitionerColorById = useMemo(() => {
    const m = new Map<string, IUser['color']>();
    for (const u of users) m.set(u.id, u.color ?? null);
    return m;
  }, [users]);

  const practitionerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.name);
    return m;
  }, [users]);

  // Sync appointments + blocked time with calendar context when data changes.
  // Use functional update to bail out when event IDs haven't changed,
  // preventing re-render loops from unstable array references.
  useEffect(() => {
    const events = [
      ...appointments.map((apt) =>
        appointmentToEvent(
          apt,
          members,
          practitionerColorById,
          practitionerNameById
        )
      ),
      ...blockedTimes.map((bt) => blockedTimeToEvent(bt, users)),
    ];
    setLocalEvents((prev) => {
      if (
        prev.length === events.length &&
        prev.every((e, i) => e.id === events[i]?.id)
      ) {
        return prev;
      }
      return events;
    });
  }, [
    appointments,
    blockedTimes,
    members,
    users,
    setLocalEvents,
    practitionerColorById,
    practitionerNameById,
  ]);

  const dialogInitial = useMemo(() => {
    if (!editOpeningHoursDate) return null;
    return resolveDateOpening(editOpeningHoursDate, schedule);
  }, [editOpeningHoursDate, schedule]);

  return (
    <>
      {children}
      {editOpeningHoursDate && selectedLocationId && dialogInitial && (
        <EditOpeningHoursDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditOpeningHoursDate(null);
          }}
          locationId={selectedLocationId}
          date={editOpeningHoursDate}
          initial={{
            fromMinutes: dialogInitial.fromMinutes,
            toMinutes: dialogInitial.toMinutes,
            closed: dialogInitial.closed,
          }}
          standing={schedule?.openingHours ?? null}
          organizationDefault={schedule?.organizationDefault ?? null}
        />
      )}
    </>
  );
}

interface PendingDrop {
  originalEvent: IEvent;
  updatedEvent: IEvent;
  resolve: (result: {
    confirmed: boolean;
    options?: Record<string, unknown>;
  }) => void;
}

interface AppointmentsProviderProps {
  children: React.ReactNode;
  /** Day to open on, from the route's `?date=` search param. */
  initialDate?: Date;
}

/**
 * AppointmentsProvider wraps children with CalendarProvider
 * configured for appointments mode with real API data
 */
export function AppointmentsProvider({
  children,
  initialDate,
}: AppointmentsProviderProps) {
  const { data: organization, isLoading: isOrgLoading } =
    useActiveOrganization();
  const organizationId = organization?.id || '';

  // Fetch members for user display in events
  const { members, isLoading: isMembersLoading } =
    useGetOrganizationMembers(organizationId);

  // Fetch practitioners for the UserSelect dropdown
  const { practitioners, isLoading: isPractitionersLoading } =
    useListPractitioners({ params: { isActive: true, bookable: true } });

  // The calendar no longer picks a location — the sidebar's LocationSwitcher
  // does, and this follows it. `locations` is still needed to label a shift's
  // branch in the staff header menu.
  const { locations: rawLocations } = useListLocations();
  const { location: activeLocation } = useActiveLocation();
  const calendarLocations: ICalendarLocation[] = useMemo(
    () =>
      rawLocations.map((l) => ({
        id: l.id,
        name: l.name,
        isPrimary: l.isPrimary,
      })),
    [rawLocations]
  );

  // Initial data fetch for appointments (wider range for initial load)
  const now = useRef(new Date()).current;
  const initialRange = {
    start: startOfWeek(startOfMonth(now)),
    end: endOfWeek(endOfMonth(now)),
  };

  const { appointments, isLoading: isAppointmentsLoading } =
    useListAppointments({
      startDateFrom: initialRange.start,
      startDateTo: initialRange.end,
      limit: 500,
    });

  const { blockedTimes: initialBlockedTimes, isLoading: isBlockedTimeLoading } =
    useListBlockedTime({
      from: initialRange.start.toISOString(),
      to: initialRange.end.toISOString(),
    });

  const { shiftDays: initialShiftDays } = useListShifts({
    from: initialRange.start.toISOString(),
    to: initialRange.end.toISOString(),
  });

  const initialResolvedShifts = useMemo(
    () => initialShiftDays.map(toCalendarShift),
    [initialShiftDays]
  );

  // Mutations for update/delete (create uses custom dialogs)
  const { updateAppointmentAsync } = useUpdateAppointment();
  const { deleteAppointmentAsync } = useDeleteAppointment();
  const { updateBlockedTimeAsync } = useUpdateBlockedTime();
  const { deleteBlockedTimeAsync } = useDeleteBlockedTime();

  // Pending drop state for confirmation dialog
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);

  // Convert practitioners to users for the UserSelect dropdown. The
  // practitioner's org-scoped color tints their events + blocked-time
  // blocks (see appointmentToEvent / blockedTimeToEvent).
  const users: IUser[] = useMemo(
    () =>
      practitioners.map((p) => ({
        id: p.id,
        name: p.name,
        picturePath: p.photo ?? null,
        userId: p.userId ?? null,
        color: (p.color ?? null) as IUser['color'],
      })),
    [practitioners]
  );

  // Lookup: appointment.practitionerId → practitioner.color (for tinting
  // appointments whose assignee is a practitioner).
  const practitionerColorById = useMemo(() => {
    const m = new Map<string, IUser['color']>();
    for (const p of practitioners) {
      m.set(p.id, (p.color ?? null) as IUser['color']);
    }
    return m;
  }, [practitioners]);

  const practitionerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of practitioners) {
      m.set(p.id, p.name);
    }
    return m;
  }, [practitioners]);

  // Convert appointments + blocked time to events
  const events: IEvent[] = useMemo(() => {
    return [
      ...appointments.map((apt) =>
        appointmentToEvent(
          apt,
          members,
          practitionerColorById,
          practitionerNameById
        )
      ),
      ...initialBlockedTimes.map((bt) => blockedTimeToEvent(bt, users)),
    ];
  }, [
    appointments,
    initialBlockedTimes,
    members,
    users,
    practitionerColorById,
    practitionerNameById,
  ]);

  // Custom event filter: match selected practitioner against event metadata.
  // Org-wide blocked time (no practitioner) is always visible.
  const eventFilter = useCallback(
    (event: IEvent, selectedUserId: string) => {
      const practitioner = users.find((u) => u.id === selectedUserId);
      if (!practitioner) return false;
      return eventBelongsToPractitioner(event, practitioner);
    },
    [users]
  );

  // Confirm drop handler — returns a Promise that resolves when the user makes a choice
  const handleConfirmDrop = useCallback(
    (params: { originalEvent: IEvent; updatedEvent: IEvent }) => {
      // Blocked time doesn't email leads — apply the move immediately.
      if (params.updatedEvent.metadata?.type === 'blocked-time') {
        return Promise.resolve({ confirmed: true });
      }
      return new Promise<{
        confirmed: boolean;
        options?: Record<string, unknown>;
      }>((resolve) => {
        setPendingDrop({
          originalEvent: params.originalEvent,
          updatedEvent: params.updatedEvent,
          resolve,
        });
      });
    },
    []
  );

  // Update event callback (used by drag-drop and edit dialog)
  const handleUpdateEvent = useCallback(
    async (event: IEvent, options?: Record<string, unknown>) => {
      try {
        if (event.metadata?.type === 'blocked-time') {
          const isRecurring = !!event.metadata.rrule;
          const originalStart = event.metadata.originalStart as
            | string
            | null
            | undefined;
          await updateBlockedTimeAsync({
            id: String(event.metadata.blockedTimeId ?? event.id),
            // Dragging one occurrence of a recurring series edits just that
            // occurrence; non-recurring blocks edit the single series.
            scope: isRecurring ? 'this' : 'all',
            ...(isRecurring && originalStart
              ? { originalStart: new Date(originalStart) }
              : {}),
            title: event.title,
            description: event.description || null,
            startDate: new Date(event.startDate),
            endDate: new Date(event.endDate),
          });
          return;
        }

        // ONE intent assembly for every appointment update (drag/resize, edit
        // dialog, mobile sheet) → the update hook → the single body builder.
        // `event.user.id` is the owning USER id and `metadata.practitionerId`
        // the practitioner id; the branded intent routes each to its own field
        // so a practitioner id can never be written into the user FK.
        await updateAppointmentAsync(
          updateIntentFromCalendarEvent(event, {
            sendRescheduleEmail: options?.sendRescheduleEmail as
              | boolean
              | undefined,
            rescheduleMessage: options?.rescheduleMessage as string | undefined,
          })
        );
      } catch (error) {
        // Surface the failure so the calendar's optimistic-update revert is
        // traceable when a drag-drop or resize visually snaps back.
        console.error('[calendar] update failed', {
          id: event.id,
          metadata: event.metadata,
          startDate: event.startDate,
          endDate: event.endDate,
          error,
        });
        throw error;
      }
    },
    [updateAppointmentAsync, updateBlockedTimeAsync]
  );

  // Delete event callback
  const handleDeleteEvent = useCallback(
    async (event: IEvent) => {
      if (event.metadata?.type === 'blocked-time') {
        const isRecurring = !!event.metadata.rrule;
        const originalStart = event.metadata.originalStart as
          | string
          | null
          | undefined;
        await deleteBlockedTimeAsync({
          id: String(event.metadata.blockedTimeId ?? event.id),
          scope: isRecurring ? 'this' : 'all',
          ...(isRecurring && originalStart ? { originalStart } : {}),
        });
        return;
      }
      await deleteAppointmentAsync(String(event.id));
    },
    [deleteAppointmentAsync, deleteBlockedTimeAsync]
  );

  // Dialog handlers
  const handleDialogCancel = useCallback(() => {
    pendingDrop?.resolve({ confirmed: false });
    setPendingDrop(null);
  }, [pendingDrop]);

  const handleDialogConfirmWithoutEmail = useCallback(() => {
    pendingDrop?.resolve({ confirmed: true });
    setPendingDrop(null);
  }, [pendingDrop]);

  const handleDialogConfirmWithEmail = useCallback(
    (message?: string) => {
      pendingDrop?.resolve({
        confirmed: true,
        options: {
          sendRescheduleEmail: true,
          rescheduleMessage: message,
        },
      });
      setPendingDrop(null);
    },
    [pendingDrop]
  );

  // Calendar config with custom add dialogs and callbacks.
  // The edit-opening-hours trigger uses a placeholder here — the real handler
  // is wired in AppointmentsSyncWrapper where calendar context is available.
  const config: Partial<ICalendarConfig> = useMemo(
    () => ({
      ...APPOINTMENTS_CONFIG,
      customAddDialog: ResponsiveAddDialog,
      secondaryAddDialog: AddBlockedTimeDialog,
      secondaryAddButtonLabel: 'Add blocked time',
      // customEditDialog is rendered by event-details-dialog only for
      // blocked-time events; appointments use the built-in EditEventDialog.
      customEditDialog: EditBlockedTimeDialog,
      // On mobile, replace the details dialog with a bottom sheet that
      // supports inline editing; on desktop the wrapper delegates to the
      // default dialog so behavior is unchanged.
      customEventDetailsDialog: ResponsiveEventDetailsDialog,
      mobileHeader: ({ view, basePath }) => (
        <MobileBookingsHeader view={view} basePath={basePath} />
      ),
      // Day view always renders one column per visible staff member
      // (Fresha-style team columns) on both desktop and mobile.
      dayColumnsPerStaff: true,
      // Clicking a staff column header opens the shift/actions popover.
      staffHeaderMenu: StaffHeaderMenu,
      onConfirmDrop: handleConfirmDrop,
      onUpdateEvent: handleUpdateEvent,
      onDeleteEvent: handleDeleteEvent,
      eventFilter,
      routerBasePath: '/dashboard/calendar',
      // Clicking a day in the month grid opens that day's per-staff view
      // rather than the new-appointment dialog.
      navigateToDayOnMonthCellClick: true,
      // The Staff ⇄ Rooms switch. Without it the rooms calendar is reachable
      // only by URL — the toggle previously existed only on the rooms side.
      // Renders nothing until the org has a room.
      headerAxisToggle: <StaffAxisToggleSlot />,
      // Click a booking → see and change its room, same as on the rooms axis.
      eventDetailsExtra: EventRoomsDetail,
    }),
    [handleConfirmDrop, handleUpdateEvent, handleDeleteEvent, eventFilter]
  );

  // Show loading state while fetching initial data
  const isLoading =
    isOrgLoading ||
    isMembersLoading ||
    isPractitionersLoading ||
    isAppointmentsLoading ||
    isBlockedTimeLoading;

  if (isLoading) {
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

  return (
    <CalendarProvider
      users={users}
      events={events}
      config={config}
      locations={calendarLocations}
      resolvedShifts={initialResolvedShifts}
      locationId={activeLocation?.id ?? null}
      timeZone={organization?.timezone ?? 'UTC'}
      initialDate={initialDate}
    >
      <AppointmentsSyncWrapper>{children}</AppointmentsSyncWrapper>
      {pendingDrop && (
        <RescheduleConfirmDialog
          open={true}
          originalEvent={pendingDrop.originalEvent}
          updatedEvent={pendingDrop.updatedEvent}
          onCancel={handleDialogCancel}
          onConfirmWithoutEmail={handleDialogConfirmWithoutEmail}
          onConfirmWithEmail={handleDialogConfirmWithEmail}
        />
      )}
    </CalendarProvider>
  );
}
