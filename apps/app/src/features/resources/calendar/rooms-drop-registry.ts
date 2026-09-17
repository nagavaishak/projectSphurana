/**
 * Which room column a drag was released over.
 *
 * WHY A MODULE AND NOT A PROP
 * ---------------------------
 * The shared `DroppableTimeBlock` owns the drop and knows only the DATE and
 * time slot — it has no idea which resource column it sits in, and it is a
 * read-only library component. But every one of those slots renders
 * `config.customAddDialog` as its child, and the grid passes that child the
 * column's id (`practitionerId={staff.id}`, which on this calendar IS the
 * room id). So the rooms slot registers a nested react-dnd drop target of its
 * own inside each time block.
 *
 * react-dnd drops INNERMOST-FIRST, so the room target always records the
 * column before `DroppableTimeBlock` runs and calls `config.onConfirmDrop`,
 * where the provider reads it back. One drag, one DnD system, zero shared
 * components modified.
 *
 * The value is consumed (read-and-cleared) so a drop that lands outside any
 * room column can never be attributed to the previous drag's target.
 */

let pendingTargetRoomId: string | null = null;

/** Called by the innermost room-scoped drop target. */
export function setPendingRoomDrop(resourceId: string | null): void {
  pendingTargetRoomId = resourceId;
}

/** Read-and-clear. Returns null when the drag did not end over a room column. */
export function takePendingRoomDrop(): string | null {
  const value = pendingTargetRoomId;
  pendingTargetRoomId = null;
  return value;
}

/** Discard a stale target (drag cancelled, or a test between cases). */
export function clearPendingRoomDrop(): void {
  pendingTargetRoomId = null;
}
