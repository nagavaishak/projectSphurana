import type {
  ResourceCategoryKind,
  ResourceWarning,
} from '@borradh-workspace/api-client/types';
import { format } from 'date-fns';
import { AlertTriangleIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
// Deep import, NOT the `@/features/organization` barrel: the barrel pulls the
// router in, which breaks the create-appointment form contract test's isolated
// render. Same reason `features/organization/api/get-active-organization` is
// imported directly elsewhere in router-free code.
import { useActiveOrganization } from '@/features/organization/api/get-active-organization';
import {
  useListResources,
  useReassignAppointmentResource,
  useResourceAllocations,
} from '@/features/resources';
import { zonedEvent } from '@/lib/timezone';
import { cn } from '@/lib/utils';

import {
  type BookingWindow,
  RESOURCE_WARNING_TEXT_CLASSES,
  busyResourceIds,
  categoryNoun,
  categoryNounLower,
  eligibleResources,
  useResourceScheduling,
} from './appointment-resource-gate';
import { AppointmentResourceOptions } from './appointment-resource-picker';

/**
 * WARN-DON'T-BLOCK — the staff side of resource allocation.
 *
 * A console booking that clashes with a room's existing hold SUCCEEDS; the
 * response carries `resourceWarnings[]`. The booking is real and already on
 * the calendar, so this is not an error toast: it reports what happened and
 * offers the one repair that matters ("Change room"). Rendering it red would
 * tell the front desk their booking failed when it did not.
 *
 * (Online bookings never reach here. They hard-fail with a CONFLICT whose copy
 * the BACKEND authors — "No {Category} is available at this time" /
 * "That room was just taken — please pick another time" — and which the public
 * booking wizard already surfaces verbatim through its existing toast channel.
 * Re-wording it on the client would fork the copy; see the note in
 * `features/resources/api/conflict.ts`.)
 */

/**
 * Lift `resourceWarnings` off a create/update response.
 *
 * Read structurally rather than through the response type: `resourceWarnings`
 * is an ADDITIVE field the appointment hooks do not yet name in their return
 * type, and a booking made before rooms existed simply has no such key. An
 * absent or mis-shaped value degrades to "no warnings", which is the correct
 * behaviour for every org that has not configured resources.
 */
export function resourceWarningsOf(response: unknown): ResourceWarning[] {
  const warnings = (response as { resourceWarnings?: unknown } | null)
    ?.resourceWarnings;
  return Array.isArray(warnings) ? (warnings as ResourceWarning[]) : [];
}

/** `HH:mm` in the BUSINESS timezone — never the viewer's device. */
const wallClock = (iso: string, timeZone: string): string =>
  format(zonedEvent(iso, timeZone), 'HH:mm');

/**
 * The BEFORE copy — shown the moment an operator picks a resource that is
 * already taken, while they can still change their mind.
 *
 * Deliberately the mirror of {@link resourceWarningMessage}, which is the
 * AFTER copy ("Booked anyway"). Same facts, same order, different tense: one
 * describes a decision still open, the other one already taken. Overbooking a
 * room is a legitimate thing for a front desk to do — they can see the room
 * and the diary cannot — so neither message refuses, and both name the clash
 * precisely enough to be argued with.
 *
 * The clash is computed CLIENT-SIDE from the allocations the calendar already
 * has, so it cannot name the other booking's title (the feed carries holds,
 * not appointments). The window is the part that matters: it is what the
 * operator checks against the diary in front of them.
 */
export function resourceOverbookWarning(
  resourceName: string,
  clash: { startDate: string; endDate: string },
  timeZone: string
): string {
  return `${resourceName} is already booked ${wallClock(clash.startDate, timeZone)}–${wallClock(clash.endDate, timeZone)}.`;
}

/**
 * The toast copy.
 *
 * TWO shapes, and the second is the one that bites: when a required category
 * holds no usable resource at all, `resourceId` / `resourceName` are null.
 * Interpolating them would print the literal string "null is already booked",
 * so the sentence changes entirely rather than degrading.
 *
 * (`resourceName` and the conflict fields are declared non-nullable by the
 * api-client type but ARE nullable on the wire — see the backend's
 * `ResourceWarning`. Truthiness checks read correctly under both.)
 */
export function resourceWarningMessage(
  warning: ResourceWarning,
  options: { timeZone: string; categoryKind?: ResourceCategoryKind }
): string {
  const { timeZone, categoryKind } = options;

  if (!warning.resourceName) {
    return `No ${categoryNounLower(categoryKind)} is available for this time. Booked anyway.`;
  }

  const window =
    warning.conflictStart && warning.conflictEnd
      ? `${wallClock(warning.conflictStart, timeZone)}–${wallClock(warning.conflictEnd, timeZone)}`
      : '';
  const title = warning.conflictingAppointmentTitle;

  if (window && title) {
    return `${warning.resourceName} is already booked ${window} for "${title}". Booked anyway.`;
  }
  if (window) {
    return `${warning.resourceName} is already booked ${window}. Booked anyway.`;
  }
  if (title) {
    return `${warning.resourceName} is already booked for "${title}". Booked anyway.`;
  }
  return `${warning.resourceName} is already booked. Booked anyway.`;
}

/** What the "Change room" action needs to open a working override. */
interface OverrideTarget {
  appointmentId: string;
  categoryId: string;
  categoryName: string;
  categoryKind: ResourceCategoryKind;
  window: BookingWindow | null;
}

export interface NotifyResourceWarningsInput {
  /** The create/update response — warnings are lifted off it. */
  response: unknown;
  appointmentId: string;
  /** The appointment's own window, so the override list shows free/busy. */
  window: BookingWindow | null;
}

/**
 * Raise one toast per warning, each with a working "Change room" action.
 *
 * Returns the dialog the action opens; the caller must render it. It lives
 * outside the booking dialog on purpose — the create dialog closes on success,
 * and an override anchored inside it would unmount before the user could
 * reach the toast.
 */
export function useResourceWarningToasts() {
  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';
  const { enabled, categories } = useResourceScheduling();
  const [target, setTarget] = useState<OverrideTarget | null>(null);

  const kindByCategoryId = useMemo(
    () => new Map(categories.map((category) => [category.id, category.kind])),
    [categories]
  );

  const notifyResourceWarnings = useCallback(
    ({ response, appointmentId, window }: NotifyResourceWarningsInput) => {
      // THE GATE. An org with no resources cannot produce a warning, and must
      // never see resource copy even if a stray field arrives.
      if (!enabled) return;

      for (const warning of resourceWarningsOf(response)) {
        const categoryKind = kindByCategoryId.get(warning.categoryId);
        const noun = categoryNounLower(categoryKind);

        toast.warning(
          resourceWarningMessage(warning, { timeZone, categoryKind }),
          {
            action: {
              label: `Change ${noun}`,
              onClick: () =>
                setTarget({
                  appointmentId,
                  categoryId: warning.categoryId,
                  categoryName: warning.categoryName,
                  categoryKind: categoryKind ?? 'other',
                  window,
                }),
            },
          }
        );
      }
    },
    [enabled, kindByCategoryId, timeZone]
  );

  const resourceOverrideDialog = (
    <AppointmentResourceOverrideDialog
      target={target}
      onClose={() => setTarget(null)}
    />
  );

  return { notifyResourceWarnings, resourceOverrideDialog };
}

interface AppointmentResourceOverrideDialogProps {
  target: OverrideTarget | null;
  onClose: () => void;
}

/**
 * The "Change room" surface. Same option list as the chip's popover, so the
 * two can never present free/busy differently — reached from a toast, where a
 * Popover has nothing to anchor to.
 */
function AppointmentResourceOverrideDialog({
  target,
  onClose,
}: AppointmentResourceOverrideDialogProps) {
  const { resources } = useListResources({
    categoryId: target?.categoryId ?? '',
  });
  const { allocations } = useResourceAllocations({
    from: target?.window ? target.window.start.toISOString() : '',
    to: target?.window ? target.window.end.toISOString() : '',
  });
  const { reassignResource, isReassigning, conflict, forceReassign } =
    useReassignAppointmentResource({ onSuccess: onClose });

  const candidates = useMemo(
    () => eligibleResources(resources, target?.categoryId ?? '', []),
    [resources, target]
  );
  const busy = useMemo(
    () =>
      busyResourceIds(
        allocations,
        target?.window ?? null,
        candidates,
        target?.appointmentId
      ),
    [allocations, target, candidates]
  );

  if (!target) return null;
  const noun = categoryNoun(target.categoryKind);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>Change {noun.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Pick another {target.categoryName.toLowerCase()} for this booking.
          </DialogDescription>
        </DialogHeader>

        <AppointmentResourceOptions
          candidates={candidates}
          busy={busy}
          selectedResourceId={null}
          onSelect={(resourceId) =>
            reassignResource({
              appointmentId: target.appointmentId,
              categoryId: target.categoryId,
              resourceId,
              optimistic: {
                resourceName: candidates.find((r) => r.id === resourceId)?.name,
              },
            })
          }
          emptyLabel={`No ${noun.toLowerCase()} is available to move this booking to.`}
        />

        {/*
          A 409 is the EXPECTED answer to picking a busy option, not a failure.
          The hook deliberately does not toast it, so the prompt — and the one
          affordance that resolves it — lives here.
        */}
        {conflict && (
          <div
            className={cn(
              'flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs',
              RESOURCE_WARNING_TEXT_CLASSES
            )}
          >
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p>{conflict.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 h-7"
                disabled={isReassigning}
                onClick={forceReassign}
              >
                Book it anyway
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
