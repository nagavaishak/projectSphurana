import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { type ResourceConflict, toResourceConflict } from '../conflict';
import type {
  AppointmentResourceAllocation,
  AppointmentResourceSource,
} from '../types';

export interface ReassignAppointmentResourceInput {
  /** Path param — the appointment whose allocation is moving. */
  appointmentId: string;
  /** Which requirement slot is being reassigned (an appointment can hold several). */
  categoryId: string;
  /** The drop target, or `null` to UNASSIGN — release the category's hold. */
  resourceId: string | null;
  /** Knowingly double-book past a 409. Only staff may do this. */
  force?: boolean;
  /**
   * CLIENT-ONLY — never sent to the API.
   *
   * The drop target's name and colour. Without them the optimistic block moves
   * to the new column while still painted in the OLD room's colour and
   * carrying the old room's label, which looks like a half-finished drag. The
   * calendar already knows both (it rendered the column), so it passes them in.
   */
  optimistic?: {
    resourceName?: string;
    resourceColor?: string | null;
  };
}

/** A 409 from the reassign endpoint, plus the attempt that earned it. */
export interface ReassignResourceConflict extends ResourceConflict {
  /** Resend these with `force: true` to override — see `forceReassign`. */
  variables: ReassignAppointmentResourceInput;
}

/** A staff drag is always a manual assignment, whatever it was before. */
const MANUAL: AppointmentResourceSource = 'manual';

interface UseReassignAppointmentResourceOptions {
  onSuccess?: (variables: ReassignAppointmentResourceInput) => void;
  /**
   * 409 — the target room is already taken for that window. This is the
   * EXPECTED outcome of dropping onto a busy column, not a failure: offer
   * "Force" (or let the user pick another room). No error toast fires.
   */
  onConflict?: (conflict: ReassignResourceConflict) => void;
  /** Any NON-409 failure. A 409 never reaches this. */
  onError?: (error: Error) => void;
}

/**
 * Move an appointment's resource allocation to a different resource — the
 * drag-to-reassign gesture on the rooms calendar.
 *
 * OPTIMISTIC. The block must follow the cursor into its new column with no
 * flicker, so the allocation caches are patched in `onMutate` and the request
 * is treated as confirmation. On ANY failure — including the 409 — the
 * snapshot is restored and the block snaps back to the column it came from,
 * which is the honest picture: the server never moved it.
 *
 * WHY `setQueriesData` AND NOT `setQueryData`
 * -------------------------------------------
 * The allocations key carries its window: `['resources','allocations',{from,to}]`.
 * A calendar that has been paged holds several windows at once, and a
 * multi-day view's appointment can appear in more than one. Patching a single
 * exact key would leave the others stale. The prefix match patches — and the
 * snapshot restores — every cached window.
 *
 * WHY 409 IS NOT AN ERROR
 * -----------------------
 * "That room is taken" is the single most common result of this gesture and
 * the user has a real next move. Rendering it as a generic red
 * "something went wrong" toast would both misdescribe it and hide the only
 * affordance that resolves it. So the 409 is routed to `onConflict`, exposed
 * as `conflict` / `isConflict`, and `forceReassign()` replays the same move
 * with `force: true`.
 *
 * `reassignResourceAsync` still rejects on 409, like any mutation — callers
 * using the async form must catch and check `isConflictError(err)`.
 */
export const useReassignAppointmentResource = (
  options?: UseReassignAppointmentResourceOptions
) => {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<ReassignResourceConflict | null>(
    null
  );

  const mutation = useMutation({
    mutationFn: ({
      appointmentId,
      categoryId,
      resourceId,
      force,
    }: ReassignAppointmentResourceInput) =>
      apiClient.put(`appointments/${appointmentId}/resources`, {
        categoryId,
        resourceId,
        ...(typeof force === 'boolean' ? { force } : {}),
      }),

    onMutate: async (variables: ReassignAppointmentResourceInput) => {
      const { appointmentId, categoryId, resourceId, force, optimistic } =
        variables;

      // Stop an in-flight allocations fetch from landing after the patch and
      // snapping the block back to its old column mid-drag.
      await queryClient.cancelQueries({
        queryKey: queryKeys.resources.allAllocations(),
      });

      const previous = queryClient.getQueriesData<
        AppointmentResourceAllocation[]
      >({ queryKey: queryKeys.resources.allAllocations() });

      // Clear any earlier conflict so the "Force?" prompt from a previous
      // drop does not linger over this one.
      setConflict(null);

      queryClient.setQueriesData<AppointmentResourceAllocation[]>(
        { queryKey: queryKeys.resources.allAllocations() },
        (old) => {
          if (!old) return old;
          const isThisSlot = (a: AppointmentResourceAllocation) =>
            a.appointmentId === appointmentId && a.categoryId === categoryId;

          // UNASSIGN — the row goes away rather than moving.
          if (resourceId === null) return old.filter((a) => !isThisSlot(a));

          // ASSIGN from nothing. There is no cached row to patch and the
          // client cannot invent one honestly (it does not know the hold's
          // turnaround tail or its id), so this one waits for the refetch in
          // `onSettled`. Only a MOVE is optimistic.
          if (!old.some(isThisSlot)) return old;

          return old.map((allocation) => {
            // An appointment can hold one allocation per category, so both
            // parts of the match are required — moving a room must not drag
            // the equipment allocation along with it.
            if (
              allocation.appointmentId !== appointmentId ||
              allocation.categoryId !== categoryId
            ) {
              return allocation;
            }
            return {
              ...allocation,
              resourceId,
              resourceName: optimistic?.resourceName ?? allocation.resourceName,
              // `?? ` would be wrong here: null is a MEANINGFUL colour value
              // ("no colour"), so only an absent key falls through.
              resourceColor:
                optimistic && 'resourceColor' in optimistic
                  ? (optimistic.resourceColor ?? null)
                  : allocation.resourceColor,
              source: MANUAL,
              // A forced move is a knowing double-book; that is exactly what
              // `allowOverlap` records, and it drives the overlap styling.
              allowOverlap: force === true ? true : allocation.allowOverlap,
            };
          });
        }
      );

      return { previous };
    },

    onError: (error: Error, variables, context) => {
      // Roll back FIRST, so the block is already home before either branch
      // below renders anything.
      for (const [queryKey, data] of context?.previous ?? []) {
        queryClient.setQueryData(queryKey, data);
      }

      const detected = toResourceConflict(
        error,
        'That resource is already booked for this time.'
      );
      if (detected) {
        const reassignConflict: ReassignResourceConflict = {
          ...detected,
          variables,
        };
        setConflict(reassignConflict);
        options?.onConflict?.(reassignConflict);
        return;
      }

      toast.error(error.message || 'Failed to move the booking');
      options?.onError?.(error);
    },

    // No success toast: the block is already in its new column, which IS the
    // feedback. A toast on every drag would be noise.
    onSuccess: (_data, variables) => {
      options?.onSuccess?.(variables);
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.resources.allAllocations(),
      });
      // Moving a hold moves the minutes with it, so both rooms' figures are
      // now wrong — the column headers kept reporting the old split.
      queryClient.invalidateQueries({
        queryKey: queryKeys.resources.allUtilisation(),
      });
      // The appointment's own resource summary changed too.
      queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all() });
    },
  });

  const clearConflict = useCallback(() => setConflict(null), []);

  const { mutate } = mutation;

  /**
   * Replay the refused move with `force: true` — the "Force" button on the
   * conflict prompt. No-op when there is no conflict pending.
   */
  const forceReassign = useCallback(() => {
    if (!conflict) return;
    mutate({ ...conflict.variables, force: true });
  }, [conflict, mutate]);

  return {
    reassignResource: mutation.mutate,
    reassignResourceAsync: mutation.mutateAsync,
    isReassigning: mutation.isPending,
    /** The 409 — the target resource is already booked. */
    conflict,
    isConflict: conflict !== null,
    /** Retry the refused move with `force: true`. */
    forceReassign,
    /** Dismiss the conflict prompt (the user cancelled or picked another room). */
    clearConflict,
  };
};
