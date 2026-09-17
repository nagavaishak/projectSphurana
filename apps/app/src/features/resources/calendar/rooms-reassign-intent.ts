/**
 * Turning "this block was dropped on that column" into a reassignment request.
 *
 * Pure on purpose: the decision of whether a drop is a real move — and which
 * requirement slot it moves — is the part worth asserting directly, separately
 * from the mutation that performs it.
 */

import type { IEvent } from '@/components/calendar';
import type { ReassignAppointmentResourceInput } from '@/features/resources';
import type { Resource } from '@borradh-workspace/api-client/types';

import { UNASSIGNED_ROOM_ID, roomsMetadata } from './rooms-calendar-model';

/**
 * Build the reassignment for a drop, or null when the drop is a no-op.
 *
 * Returns null when:
 *  - the drag ended outside any room column;
 *  - the target is the Unassigned column (there is no "unassign by drag" — a
 *    booking's requirement still has to be met by SOME room, and the API has
 *    no endpoint that clears a hold);
 *  - the block is already in that column (a pure vertical drag).
 *
 * `optimistic` carries the target's name and colour so the block lands in its
 * new column already painted correctly instead of wearing the old room's
 * identity until the refetch — the hook never sees the column, we do.
 */
export function reassignIntentFromDrop(
  event: IEvent,
  targetResourceId: string | null,
  targetResource: Resource | undefined
): ReassignAppointmentResourceInput | null {
  if (!targetResourceId || targetResourceId === UNASSIGNED_ROOM_ID) return null;

  const metadata = roomsMetadata(event);
  if (!metadata?.categoryId) return null;
  if (metadata.resourceIds.includes(targetResourceId)) return null;

  return {
    appointmentId: metadata.appointmentId,
    categoryId: metadata.categoryId,
    resourceId: targetResourceId,
    optimistic: {
      resourceName: targetResource?.name,
      resourceColor: targetResource?.color ?? null,
    },
  };
}
