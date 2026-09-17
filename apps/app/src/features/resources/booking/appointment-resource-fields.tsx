import { parse } from 'date-fns';
import { ChevronRightIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Control, useWatch } from 'react-hook-form';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  type AppointmentCreateFormData,
  resolveAppointmentDurationMinutes,
  useAppointmentCreateContext,
} from '@/features/appointments/create';
import {
  useListResources,
  useResourceAllocations,
  useServiceResourceRequirements,
} from '@/features/resources';
import { zonedWallTimeToUtc } from '@/lib/timezone';
import { cn } from '@/lib/utils';

import {
  type BookingWindow,
  type RequiredResourceCategory,
  type SelectableResourceCategory,
  clashingHoldFor,
  resolveSelectableCategories,
  useResourceScheduling,
} from './appointment-resource-gate';
import { AppointmentResourceSelect } from './appointment-resource-select';

/**
 * Rooms & equipment on the CREATE surfaces (desktop dialog + mobile funnel).
 *
 * One chip per category the chosen service requires, shown only once the
 * service AND the time are known — before that there is nothing to be free or
 * busy against, and a chip that says "Assign room" for a booking with no slot
 * yet is noise.
 *
 * Everything here is behind {@link useResourceScheduling}. An org with no
 * resource categories gets `enabled: false`, `<AppointmentResourceFields />`
 * returns `null`, and the dialog renders exactly the markup it rendered before
 * this feature existed — no wrapper, no spacing, no empty section.
 */

export interface AppointmentResourceSelection {
  /** False ⇒ render nothing, send nothing. The regression guard. */
  enabled: boolean;
  /**
   * Every category the booking can attach — required ones first, then the rest
   * as optional. The front desk can record a room for a service that doesn't
   * demand one; requirements govern GATING, not what staff may write down.
   */
  selectableCategories: SelectableResourceCategory[];
  /** The subset the service actually demands. Drives gating copy only. */
  requiredCategories: RequiredResourceCategory[];
  /** The booking window the chips resolve free/busy against. */
  window: BookingWindow | null;
  /** categoryId → explicitly chosen resourceId. */
  chosen: Record<string, string>;
  choose: (categoryId: string, resourceId: string) => void;
  /**
   * ONLY explicit human picks, in category order.
   *
   * An `(auto)` chip contributes nothing: it is a preview of what the
   * allocator will do, and echoing a stale prediction back as an explicit
   * `resourceIds` pick would talk the server into a room it would not have
   * chosen itself. Empty ⇒ omit the key entirely and let the backend allocate.
   */
  resourceIds: string[];
  /** Manual mode — a console booking creates no allocation. */
  isManual: boolean;
  /** IANA zone of the BUSINESS — clash windows are quoted in it, never the device's. */
  timeZone: string;
  /**
   * At least one chosen resource is already taken for this window.
   *
   * The operator has been shown the clash inline; this is what tells the
   * server they meant it. Without it the INSERT loses to `resource_no_overlap`
   * and the booking is refused — which would make the warning a lie.
   */
  overbooks: boolean;
  /** resourceId → display name, so the collapsed summary can name the pick. */
  resourceNameById: Map<string, string>;
}

/**
 * Resolve the required categories and the booking window off the SHARED
 * create form, so desktop and mobile derive them identically.
 */
export function useAppointmentResourceSelection(
  control: Control<AppointmentCreateFormData>,
  /**
   * Room to start with — set when the dialog was opened from a ROOMS calendar
   * column, so booking into a column lands in that column. Seeded once the
   * category list arrives (the resource alone doesn't say which slot it fills)
   * and never re-applied, so the operator can freely change it afterwards.
   */
  preselectedResourceId?: string,
  /**
   * Whether the form is actually on screen. The desktop dialog calls this
   * hook while CLOSED (it lives in every empty slot of the grid), so the
   * free/busy fetch must wait for `open` — otherwise a day view issues one
   * allocations request per slot before anyone has clicked anything.
   */
  active = true
): AppointmentResourceSelection {
  const { enabled, categories, isManual } = useResourceScheduling();
  const { services, timeZone } = useAppointmentCreateContext();

  const serviceId = useWatch({ control, name: 'serviceId' });
  const date = useWatch({ control, name: 'date' });
  const startTime = useWatch({ control, name: 'startTime' });

  const [chosen, setChosen] = useState<Record<string, string>>({});

  // Only fetched when a preselection actually needs resolving.
  const { resources: allResources } = useListResources();

  // `enabled` short-circuits the fetch: an org with no resources never asks
  // the API what its services require.
  const { requirements } = useServiceResourceRequirements(
    active && enabled && serviceId ? serviceId : ''
  );

  const selectableCategories = useMemo(
    () => resolveSelectableCategories(requirements?.requirements, categories),
    [requirements, categories]
  );
  const requiredCategories = useMemo(
    () => selectableCategories.filter((category) => category.required),
    [selectableCategories]
  );

  const window = useMemo<BookingWindow | null>(() => {
    if (!date || !startTime) return null;
    const [hours, minutes] = startTime.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

    const day = parse(date, 'yyyy-MM-dd', new Date());
    if (Number.isNaN(day.getTime())) return null;

    // Same resolution the payload builder uses — the picked wall-clock is in
    // the BUSINESS timezone, never the viewer's device.
    const start = zonedWallTimeToUtc(day, hours, minutes, timeZone);
    const service = services.find((s) => s.id === serviceId);
    const duration = resolveAppointmentDurationMinutes(service);
    return { start, end: new Date(start.getTime() + duration * 60_000) };
  }, [date, startTime, timeZone, services, serviceId]);

  // An empty id means "Unassigned" — the key is REMOVED rather than set to '',
  // so `resourceIds` and every `chosen[id]` truthiness check agree on what an
  // unassigned category looks like.
  const choose = useCallback((categoryId: string, resourceId: string) => {
    setChosen((previous) => {
      if (!resourceId) {
        if (!(categoryId in previous)) return previous;
        const { [categoryId]: _removed, ...rest } = previous;
        return rest;
      }
      return { ...previous, [categoryId]: resourceId };
    });
  }, []);

  // Seed the preselected room into its own category slot. Guarded on the slot
  // still being empty so this cannot fight the operator: once they pick
  // something, or once seeded, it stays theirs.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !preselectedResourceId) return;
    // A resource alone does not say which requirement slot it fills, so the
    // room is looked up to read its category.
    const room = allResources.find((r) => r.id === preselectedResourceId);
    if (!room) return;
    seededRef.current = true;
    setChosen((previous) =>
      previous[room.category.id]
        ? previous
        : { ...previous, [room.category.id]: preselectedResourceId }
    );
  }, [preselectedResourceId, allResources]);

  const { allocations } = useResourceAllocations(
    window
      ? {
          from: window.start.toISOString(),
          to: window.end.toISOString(),
          enabled: active && enabled,
        }
      : { from: '', to: '' }
  );

  // Explicit picks across EVERY category, not just required ones — an
  // optional room the operator selected has to reach the server too.
  const resourceIds = useMemo(
    () =>
      selectableCategories
        .map((category) => chosen[category.categoryId])
        .filter((id): id is string => !!id),
    [selectableCategories, chosen]
  );

  // `Array.isArray` rather than a bare `.map`: this hook renders inside the
  // create dialog, whose consumers stub `useListResources` — and an undefined
  // list here throws through the whole dialog rather than degrading to "no
  // names to show".
  const resourceNameById = useMemo(
    () =>
      new Map(
        (Array.isArray(allResources) ? allResources : []).map((resource) => [
          resource.id,
          resource.name,
        ])
      ),
    [allResources]
  );

  const overbooks = useMemo(
    () =>
      resourceIds.some(
        (id) =>
          clashingHoldFor(
            allocations,
            window,
            allResources.find((resource) => resource.id === id)
          ) !== null
      ),
    [resourceIds, allocations, window, allResources]
  );

  return {
    // Enabled whenever the org has ANY usable category. Previously this was
    // gated on the service having requirements, so the section never appeared
    // for a service that needs no room — which is every pre-existing service.
    enabled: enabled && selectableCategories.length > 0,
    selectableCategories,
    requiredCategories,
    window,
    chosen,
    choose,
    resourceIds,
    isManual,
    timeZone,
    overbooks,
    resourceNameById,
  };
}

export interface AppointmentResourceFieldsProps {
  selection: AppointmentResourceSelection;
  /** Mobile uses the funnel's own label typography. */
  variant?: 'desktop' | 'mobile';
  /** Excluded from the busy set, so editing ignores the booking's own hold. */
  excludeAppointmentId?: string;
}

/**
 * The "Rooms & equipment" section. Renders `null` for any org without
 * rooms/equipment.
 *
 * Collapsed to a one-line summary when nothing is required, because for most
 * bookings the answer is "whatever's free" and the section should not push the
 * fields that matter down the dialog. It opens itself when the SERVICE demands
 * a category, since then the choice is part of the booking rather than a
 * refinement of it.
 */
export function AppointmentResourceFields({
  selection,
  variant = 'desktop',
  excludeAppointmentId,
}: AppointmentResourceFieldsProps) {
  const {
    enabled,
    selectableCategories,
    window,
    chosen,
    choose,
    isManual,
    timeZone,
  } = selection;

  const hasRequired = selectableCategories.some((c) => c.required);
  // Required categories start open; the operator's toggle wins from then on.
  const [open, setOpen] = useState(hasRequired);
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current || !hasRequired) return;
    syncedRef.current = true;
    setOpen(true);
  }, [hasRequired]);

  // THE GATE. Also holds until a slot exists — free/busy is meaningless
  // without one, and the dropdowns would flip state under the user as they
  // pick. Hooks above it so the order never changes.
  if (!enabled || !window) return null;

  const summary = summariseSelection(
    selectableCategories,
    chosen,
    selection.resourceNameById
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border"
      aria-labelledby="appointment-resources-label"
    >
      {/* `type="button"` is load-bearing: this section renders INSIDE the
          appointment form, and a bare <button> defaults to type="submit" —
          expanding the section would submit the booking. */}
      <CollapsibleTrigger
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50"
      >
        <ChevronRightIcon
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
        />
        <span
          id="appointment-resources-label"
          className={cn(
            'font-medium',
            variant === 'mobile' ? 'text-[13px]' : 'text-sm'
          )}
        >
          Rooms &amp; equipment
        </span>
        {/* Collapsed, this line is the whole state — without it the section
            reads as "there is something in here" and nothing more. */}
        <span className="ml-auto truncate pl-2 text-muted-foreground text-xs">
          {summary}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="flex flex-col gap-3 border-t px-3 py-3">
          {selectableCategories.map((category) => (
            <AppointmentResourceSelect
              key={category.categoryId}
              category={category}
              window={window}
              selectedResourceId={chosen[category.categoryId] ?? null}
              onSelect={(resourceId) =>
                choose(category.categoryId, resourceId ?? '')
              }
              excludeAppointmentId={excludeAppointmentId}
              timeZone={timeZone}
            />
          ))}

          <p className="text-muted-foreground text-xs">
            {resourceFooterCopy(isManual, hasRequired)}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * What actually happens to the categories left unassigned.
 *
 * The old single line promised "a free one is picked automatically" for
 * EVERY category, which was untrue for most of them: the allocator only ever
 * fills categories the SERVICE requires. An optional category left unassigned
 * stays unassigned, and telling the operator otherwise meant a booking they
 * believed had a room silently had none.
 */
export function resourceFooterCopy(
  isManual: boolean,
  hasRequired: boolean
): string {
  if (isManual) {
    return 'Rooms are assigned by hand at this clinic. Leave a category unassigned and set it later from the calendar.';
  }
  return hasRequired
    ? 'Anything this service requires is filled automatically if you leave it unassigned. Optional categories stay empty unless you pick one.'
    : 'Nothing here is required for this service, so nothing is assigned automatically — pick anything you want recorded.';
}

/**
 * The collapsed one-liner: "Room 2 · Laser unassigned".
 *
 * Required-but-unassigned is called out by name rather than folded into a
 * count, so a collapsed section can still say the thing that will bite.
 */
function summariseSelection(
  categories: SelectableResourceCategory[],
  chosen: Record<string, string>,
  nameById: Map<string, string>
): string {
  const assignedIds = categories
    .map((category) => chosen[category.categoryId])
    .filter((id): id is string => !!id);

  if (assignedIds.length === 0) return 'Unassigned';

  // Name what is actually held while it still fits. Booking from a room column
  // preselects that room, and "1 of 2 assigned" made the operator open the
  // section just to learn WHICH — the one thing they already knew.
  const names = assignedIds
    .map((id) => nameById.get(id))
    .filter((name): name is string => !!name);
  if (names.length === assignedIds.length && names.length <= 2) {
    return names.join(' · ');
  }

  if (assignedIds.length === categories.length) return 'All assigned';
  return `${assignedIds.length} of ${categories.length} assigned`;
}
