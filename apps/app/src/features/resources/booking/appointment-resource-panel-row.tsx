import type {
  AppointmentResourceAllocation,
  ResourceCategoryKind,
} from '@borradh-workspace/api-client/types';
import { useMemo, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
// Deep path, NOT the feature barrel: the barrel pulls the router in, and this
// row is rendered by tests that have none.
import { useActiveOrganization } from '@/features/organization/api/get-active-organization';

import {
  useListResources,
  useReassignAppointmentResource,
  useResourceAllocations,
  useServiceResourceRequirements,
} from '@/features/resources';

import {
  type BookingWindow,
  type SelectableResourceCategory,
  clashingHoldFor,
  resolveSelectableCategories,
  useResourceScheduling,
} from './appointment-resource-gate';
import { AppointmentResourceSelect } from './appointment-resource-select';
import { resourceOverbookWarning } from './appointment-resource-warnings';

/**
 * "Rooms & equipment" on the appointment side panel.
 *
 * One row per category the booking touches — allocated ones show the room with
 * the same override popover the create surfaces use, and a REQUIRED category
 * with no allocation shows an amber `Needs room` pill.
 *
 * That pill is the whole point of the row in manual mode: a console booking
 * creates no allocation, so "which of today's bookings still needs a room"
 * becomes the front desk's worklist. It is therefore the most prominent thing
 * in the section, not a footnote — same amber the warning toast uses, with an
 * icon so the state does not rest on colour.
 *
 * Renders `null` for every org with no resource categories.
 */

export interface AppointmentResourcePanelRowProps {
  appointmentId: string;
  /** `metadata.serviceId` off the calendar event — drives the requirements. */
  serviceId: string | null;
  /** ISO — the appointment's own window. */
  startDate: string;
  endDate: string;
}

export function AppointmentResourcePanelRow({
  appointmentId,
  serviceId,
  startDate,
  endDate,
}: AppointmentResourcePanelRowProps) {
  const { enabled, categories } = useResourceScheduling();

  const { requirements } = useServiceResourceRequirements(
    enabled && serviceId ? serviceId : ''
  );

  // The allocation window is the appointment's own. `endDate` on a hold
  // already includes turnaround, so a hold that starts inside this range is
  // returned even when its tail runs past it.
  const { allocations } = useResourceAllocations({
    from: enabled ? startDate : '',
    to: enabled ? endDate : '',
  });

  const window = useMemo<BookingWindow | null>(() => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return null;
    }
    return { start, end };
  }, [startDate, endDate]);

  const { reassignResource } = useReassignAppointmentResource();
  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';

  /**
   * A pick that would double-book, held back pending confirmation.
   *
   * The create dialog can warn INLINE because nothing is written until submit.
   * Here the dropdown IS the write, so an inline note would appear after the
   * room was already taken. Confirming first is what makes this the same
   * promise as the other surfaces: you are told before, not after.
   */
  const [pendingOverbook, setPendingOverbook] = useState<{
    categoryId: string;
    resourceId: string;
    message: string;
  } | null>(null);

  const { resources: allResources } = useListResources();

  /** This appointment's own holds, keyed by category. */
  const held = useMemo(() => {
    const map = new Map<string, AppointmentResourceAllocation>();
    if (!Array.isArray(allocations)) return map;
    for (const allocation of allocations) {
      if (allocation.appointmentId !== appointmentId) continue;
      map.set(allocation.categoryId, allocation);
    }
    return map;
  }, [allocations, appointmentId]);

  // EVERY usable category, not just the required ones. A booking made before
  // this feature existed requires nothing, so a required-only list rendered
  // an empty section — the front desk could see rooms but not put anyone in
  // one. Requirements decide what is GATED, never what staff may record.
  const selectableCategories = useMemo(
    () => resolveSelectableCategories(requirements?.requirements, categories),
    [requirements, categories]
  );

  /**
   * Required ∪ allocated. A hold can outlive the requirement that created it
   * (the service was edited afterwards) — dropping it would leave a room
   * silently held with nothing in the UI able to release or move it.
   */
  const rows = useMemo(() => {
    const merged: SelectableResourceCategory[] = [...selectableCategories];
    const seen = new Set(merged.map((c) => c.categoryId));
    for (const [categoryId, allocation] of held) {
      if (seen.has(categoryId)) continue;
      const category = categories.find((c) => c.id === categoryId);
      merged.push({
        categoryId,
        categoryName: category?.name ?? allocation.resourceName,
        categoryKind: (category?.kind ?? 'other') as ResourceCategoryKind,
        eligibleResourceIds: [],
        required: false,
      });
    }
    return merged;
  }, [selectableCategories, held, categories]);

  // THE GATE.
  // Also holds until the window parses — free/busy has nothing to resolve
  // against without one.
  if (!enabled || !window || rows.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="font-medium text-muted-foreground text-xs">
        Rooms &amp; equipment
      </p>
      <div className="mt-2 flex flex-col gap-3">
        {rows.map((category) => {
          const allocation = held.get(category.categoryId);
          return (
            <AppointmentResourceSelect
              key={category.categoryId}
              category={category}
              window={window}
              selectedResourceId={allocation?.resourceId ?? null}
              // The panel describes what IS. It shows the room actually held,
              // never a preview of what the allocator would pick — an
              // unassigned category here is a real worklist item.
              excludeAppointmentId={appointmentId}
              timeZone={timeZone}
              onSelect={(resourceId) => {
                const clash = resourceId
                  ? clashingHoldFor(
                      allocations,
                      window,
                      allResources.find((r) => r.id === resourceId),
                      appointmentId
                    )
                  : null;

                if (clash && resourceId) {
                  setPendingOverbook({
                    categoryId: category.categoryId,
                    resourceId,
                    message: resourceOverbookWarning(
                      clash.resourceName,
                      clash,
                      timeZone
                    ),
                  });
                  return;
                }

                reassignResource({
                  appointmentId,
                  categoryId: category.categoryId,
                  resourceId,
                });
              }}
            />
          );
        })}
      </div>

      <AlertDialog
        open={pendingOverbook !== null}
        onOpenChange={(open) => {
          if (!open) setPendingOverbook(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Double-book this room?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingOverbook?.message} Putting this booking in it too means
              two appointments share the room for that time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingOverbook) return;
                // `force` is what the confirmation BUYS. Without it the write
                // loses to `resource_no_overlap` and comes back a 409 — the
                // operator would have agreed to something the server then
                // refused.
                reassignResource({
                  appointmentId,
                  categoryId: pendingOverbook.categoryId,
                  resourceId: pendingOverbook.resourceId,
                  force: true,
                });
                setPendingOverbook(null);
              }}
            >
              Book it anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
