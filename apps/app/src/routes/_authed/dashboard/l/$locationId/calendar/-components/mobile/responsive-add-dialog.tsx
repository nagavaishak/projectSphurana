import { useIsMobile } from '@/hooks/use-mobile';

import { AddAppointmentDialog } from '../add-appointment-dialog';

import { MobileAddBookingFlow } from './mobile-add-booking-flow';

interface ResponsiveAddDialogProps {
  children?: React.ReactNode;
  startDate?: Date;
  startTime?: { hour: number; minute: number };
  practitionerId?: string;
  /** Room to start with — set when opened from a rooms-calendar column. */
  preselectedResourceId?: string;
  /** Controlled open state (desktop only — e.g. the header "Add" menu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Conforms to ICalendarConfig.customAddDialog. Renders the desktop
 * AddAppointmentDialog on >=md screens and the multi-step mobile flow on
 * smaller viewports.
 */
export function ResponsiveAddDialog({
  open,
  onOpenChange,
  ...props
}: ResponsiveAddDialogProps) {
  const isMobile = useIsMobile();
  // Controlled open (open/onOpenChange) is a desktop-only affordance used by
  // the header "Add" menu; the mobile flow is always trigger-driven.
  if (isMobile) return <MobileAddBookingFlow {...props} />;
  return (
    <AddAppointmentDialog {...props} open={open} onOpenChange={onOpenChange} />
  );
}
