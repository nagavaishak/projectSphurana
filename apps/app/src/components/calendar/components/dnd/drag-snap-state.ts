/**
 * Shared snapped-delta state written by CustomDragLayer (on every preview
 * frame) and read by drop handlers. Lets the drop handler use the exact
 * value the preview last rendered with, instead of re-deriving from
 * `monitor.getClientOffset()` at drop time — those can disagree by a few
 * pixels because react-dnd updates its cursor on hover/dragover actions,
 * and the drop event can fire before the next hover lands.
 */
export const dragSnapState = {
  snappedDeltaY: 0,
  snappedDeltaX: 0,
};

export function resetDragSnapState() {
  dragSnapState.snappedDeltaY = 0;
  dragSnapState.snappedDeltaX = 0;
}
