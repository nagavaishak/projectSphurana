/**
 * Re-export of the item primitives, which now live in `content-items`.
 *
 * Kept as a seam so the batch services read the same as they did before the
 * move; a batch is one producer of content items, not their owner.
 */
export {
  loadSlotForOrg,
  loadPendingSlotForOrg,
  insertSlotWithFirstAttempt,
  recordAttempt,
  type SlotWithAttempt,
  type InsertSlotInput,
  type RecordAttemptInput,
} from '../../../content-items/index.js';
