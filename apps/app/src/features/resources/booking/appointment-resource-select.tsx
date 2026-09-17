'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useListResources, useResourceAllocations } from '@/features/resources';
import { cn } from '@/lib/utils';

import {
  type BookingWindow,
  RESOURCE_WARNING_TEXT_CLASSES,
  type SelectableResourceCategory,
  busyResourceIds,
  categoryNounLower,
  clashingHoldFor,
  eligibleResources,
} from './appointment-resource-gate';
import { resourceOverbookWarning } from './appointment-resource-warnings';

/** Sentinel for "leave it unassigned". Radix Select rejects an empty value. */
export const UNASSIGNED_VALUE = '__unassigned__';

interface AppointmentResourceSelectProps {
  category: SelectableResourceCategory;
  window: BookingWindow;
  selectedResourceId: string | null;
  onSelect: (resourceId: string | null) => void;
  /** Excluded from the busy set, so editing a booking ignores its own hold. */
  excludeAppointmentId?: string;
  /** IANA zone of the BUSINESS — the clash window is quoted in it. */
  timeZone: string;
}

/**
 * One category, as a dropdown — "Rooms", "Lasers" — defaulting to Unassigned.
 *
 * WHY A DROPDOWN AND NOT THE OLD CHIP. The chip showed the room the allocator
 * WOULD pick, labelled "(auto)". That reads as a decision already made, and it
 * pre-filled a value the operator never chose — so the honest options were
 * "accept what it guessed" or "hunt for the override". Front desks want to say
 * "put her in Room 2", and for a service with no requirement they previously
 * could not say anything at all.
 *
 * Unassigned is the default and it means it: nothing is sent, and the server
 * allocates (or, in manual mode, leaves it empty). Picking a room sends it
 * explicitly.
 *
 * OVERBOOKING IS ALLOWED, AND WARNED ABOUT BEFOREHAND. Busy rooms stay
 * selectable — the front desk can see the room and the diary cannot — but they
 * are labelled in the list, and picking one raises an amber line naming the
 * clash *before* anything is written. The operator can then change their mind
 * for free. Refusing instead would just get worked around; warning only after
 * the write tells them about a decision they can no longer take back.
 */
export function AppointmentResourceSelect({
  category,
  window,
  selectedResourceId,
  onSelect,
  excludeAppointmentId,
  timeZone,
}: AppointmentResourceSelectProps) {
  const { resources } = useListResources();
  const { allocations } = useResourceAllocations({
    from: window.start.toISOString(),
    to: window.end.toISOString(),
  });

  const candidates = eligibleResources(
    resources,
    category.categoryId,
    category.eligibleResourceIds
  );
  const busy = busyResourceIds(
    allocations,
    window,
    resources,
    excludeAppointmentId
  );

  // The clash behind the CURRENT pick, if any — this is what the warning says.
  const clash = clashingHoldFor(
    allocations,
    window,
    candidates.find((resource) => resource.id === selectedResourceId),
    excludeAppointmentId
  );

  const noun = categoryNounLower(category.categoryKind);
  const id = `resource-select-${category.categoryId}`;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 font-medium text-sm"
      >
        {category.categoryName}
        {!category.required && (
          <span className="font-normal text-muted-foreground text-xs">
            optional
          </span>
        )}
      </label>

      <Select
        value={selectedResourceId ?? UNASSIGNED_VALUE}
        onValueChange={(value) =>
          onSelect(value === UNASSIGNED_VALUE ? null : value)
        }
      >
        <SelectTrigger id={id} aria-label={`Choose ${noun}`}>
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
          {candidates.map((resource) => {
            const isBusy = busy.has(resource.id);
            return (
              <SelectItem key={resource.id} value={resource.id}>
                <span className="flex items-center gap-2">
                  <span className={cn(isBusy && 'text-muted-foreground')}>
                    {resource.name}
                  </span>
                  {/* Text, not just colour — the state has to survive a
                      colour-blind reader and a greyscale screenshot. */}
                  {isBusy && (
                    <span className="text-muted-foreground text-xs">
                      · booked
                    </span>
                  )}
                </span>
              </SelectItem>
            );
          })}
          {candidates.length === 0 && (
            <div className="px-2 py-1.5 text-muted-foreground text-sm">
              Nothing set up in {category.categoryName}
            </div>
          )}
        </SelectContent>
      </Select>

      {clash && (
        <p
          className={cn('text-xs', RESOURCE_WARNING_TEXT_CLASSES)}
          role="status"
        >
          {resourceOverbookWarning(clash.resourceName, clash, timeZone)} Booking
          it here double-books the {noun}.
        </p>
      )}
    </div>
  );
}
