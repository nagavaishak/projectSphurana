import { Slot } from '@radix-ui/react-slot';
import { useState } from 'react';

import type { IEvent } from '@/components/calendar';
import {
  BlockedTimeDialog,
  type BlockedTimeEditTarget,
} from './blocked-time-dialog';

/**
 * Calendar adapter for BlockedTimeDialog in create mode, conforming to
 * ICalendarConfig.secondaryAddDialog: opened by its trigger child (header
 * button) or programmatically with pre-filled times (drag-to-create).
 * Replaces the old AddUnavailabilityDialog entry point.
 */
export function AddBlockedTimeDialog({
  children,
  startDate,
  startTime,
  endTime,
  open: controlledOpen,
  onOpenChange,
}: {
  children?: React.ReactNode;
  startDate?: Date;
  startTime?: { hour: number; minute: number };
  endTime?: { hour: number; minute: number };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <>
      {children !== undefined && (
        <Slot onClick={() => setOpen(true)}>{children}</Slot>
      )}
      {open && (
        <BlockedTimeDialog
          open={open}
          onOpenChange={setOpen}
          initial={{ startDate, startTime, endTime }}
        />
      )}
    </>
  );
}

/**
 * Extract the blocked-time edit target from a calendar event produced by
 * the appointments provider (see blockedTimeToEvent).
 */
export function blockedTimeTargetFromEvent(
  event: IEvent
): BlockedTimeEditTarget {
  const metadata = event.metadata ?? {};
  return {
    id: String(metadata.blockedTimeId ?? event.id),
    originalStart: metadata.originalStart as string | undefined,
    rrule: (metadata.rrule as string | null | undefined) ?? null,
    recurrenceEndDate:
      (metadata.recurrenceEndDate as string | null | undefined) ?? null,
    blockedTimeTypeId:
      (metadata.blockedTimeTypeId as string | null | undefined) ?? null,
    title: event.title,
    description: event.description || null,
    startDate: event.startDate,
    endDate: event.endDate,
    practitionerIds: Array.isArray(metadata.practitionerIds)
      ? (metadata.practitionerIds as string[])
      : [],
    paid: Boolean(metadata.paid),
  };
}

/**
 * Calendar adapter for BlockedTimeDialog in edit mode, conforming to
 * ICalendarConfig.customEditDialog. Replaces EditUnavailabilityDialog:
 * recurring occurrences get the this/following/all scope prompt inside the
 * dialog.
 */
export function EditBlockedTimeDialog({
  event,
  onClose,
}: {
  event: IEvent;
  onClose: () => void;
}) {
  return (
    <BlockedTimeDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      editing={blockedTimeTargetFromEvent(event)}
    />
  );
}
