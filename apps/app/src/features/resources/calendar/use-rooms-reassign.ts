/**
 * Drag-to-reassign on the rooms calendar.
 *
 * The mutation is already optimistic with rollback (see
 * `useReassignAppointmentResource`), so this hook only has to do the two
 * things the calendar knows and the hook does not: WHICH column the block was
 * dropped on, and what a 409 should look like to a person.
 *
 * A 409 ("that room is taken") is not a failure here — it is the most common
 * outcome of dropping onto a busy column, and staff have a real next move. The
 * block snaps back on its own (the mutation restores its snapshot) and we
 * surface the API's own wording with a **Force** action that replays the same
 * move with `force: true`.
 */

import { useCallback, useRef } from 'react';
import { toast } from 'sonner';

import type { IEvent } from '@/components/calendar';
import {
  type ReassignAppointmentResourceInput,
  useReassignAppointmentResource,
} from '@/features/resources';
import type { Resource } from '@borradh-workspace/api-client/types';

import { reassignIntentFromDrop } from './rooms-reassign-intent';

export interface UseRoomsReassignResult {
  /** Handle a block released over `targetResourceId`. No-op for a non-move. */
  dropOnRoom: (event: IEvent, targetResourceId: string | null) => void;
  isReassigning: boolean;
}

export function useRoomsReassign(
  resourceById: Map<string, Resource>
): UseRoomsReassignResult {
  // `reassignResource` is defined by the call below, but the Force action only
  // runs on a later click — a ref keeps that closure pointing at the current
  // mutate instead of capturing the first render's.
  const reassignRef = useRef<
    ((input: ReassignAppointmentResourceInput) => void) | null
  >(null);

  const { reassignResource, isReassigning } = useReassignAppointmentResource({
    onConflict: (conflict) => {
      // Render the API's copy verbatim — it already reads as instructions and
      // a second wording here would drift from the backend's.
      toast.error(conflict.message, {
        action: {
          label: 'Force',
          onClick: () =>
            reassignRef.current?.({ ...conflict.variables, force: true }),
        },
      });
    },
  });

  reassignRef.current = reassignResource;

  const dropOnRoom = useCallback(
    (event: IEvent, targetResourceId: string | null) => {
      const intent = reassignIntentFromDrop(
        event,
        targetResourceId,
        targetResourceId ? resourceById.get(targetResourceId) : undefined
      );
      if (!intent) return;
      reassignResource(intent);
    },
    [reassignResource, resourceById]
  );

  return { dropOnRoom, isReassigning };
}
