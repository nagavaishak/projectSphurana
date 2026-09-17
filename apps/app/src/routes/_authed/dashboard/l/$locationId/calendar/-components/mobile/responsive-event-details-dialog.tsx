import { useSidePanel } from '@/components/app/side-panel';
import { isTimeBlockEvent, useCalendar } from '@/components/calendar';
import { DefaultEventDetailsDialog } from '@/components/calendar/components/dialogs/event-details-dialog';
import { useUpdateEvent } from '@/components/calendar/hooks/use-update-event';
import { useIsMobile } from '@/hooks/use-mobile';

import { AppointmentSidePanel } from '../appointment-side-panel';
import { MobileBookingDetailSheet } from './mobile-booking-detail-sheet';

import type { IEvent } from '@/components/calendar/interfaces';

interface ResponsiveEventDetailsDialogProps {
  event: IEvent;
  children: React.ReactNode;
}

/**
 * Conforms to ICalendarConfig.customEventDetailsDialog. Mobile uses the
 * detail/edit bottom sheet. On desktop, appointments open in the docked
 * side-panel (view + edit), while time BLOCKS keep the calendar's default
 * dialog (which carries their delete + custom-edit flow).
 *
 * The block check goes through `isTimeBlockEvent`: a hand-rolled
 * `'unavailability'` test missed the provider's `'blocked-time'` tag and opened
 * the APPOINTMENT editor on a block.
 */
export function ResponsiveEventDetailsDialog({
  event,
  children,
}: ResponsiveEventDetailsDialogProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <MobileBookingDetailSheet event={event}>
        {children}
      </MobileBookingDetailSheet>
    );
  }

  if (isTimeBlockEvent(event)) {
    return (
      <DefaultEventDetailsDialog event={event}>
        {children}
      </DefaultEventDetailsDialog>
    );
  }

  return (
    <DesktopAppointmentTrigger event={event}>
      {children}
    </DesktopAppointmentTrigger>
  );
}

/**
 * Desktop trigger: clicking an appointment opens the shared side-panel. Lives
 * inside the calendar provider so it can hand the panel the canonical update
 * path (`updateEvent` → `config.onUpdateEvent`), the staff list, and delete.
 */
function DesktopAppointmentTrigger({
  event,
  children,
}: ResponsiveEventDetailsDialogProps) {
  const { users, config } = useCalendar();
  const { updateEvent } = useUpdateEvent();
  const { open } = useSidePanel();

  const showPanel = () =>
    open(
      <AppointmentSidePanel
        event={event}
        users={users}
        onCommit={(updated) => updateEvent(updated)}
        onDelete={(e) => config.onDeleteEvent?.(e)}
      />
    );

  return (
    // Clickable wrapper — bypasses DraggableEvent's drag delay.
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        showPanel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
          showPanel();
        }
      }}
    >
      {children}
    </div>
  );
}
