import { z } from 'zod';

export const listBatchItemClipsSchema = z.object({
  itemId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type ListBatchItemClipsInput = z.infer<typeof listBatchItemClipsSchema>;

export interface BatchItemClip {
  assetId: string;
  name: string;
  thumbnailUrl: string | null;
  /**
   * The clip itself, so the card can play it full screen. Null when the asset
   * has no playable file yet — footage still transcoding, most often.
   */
  blobUrl: string | null;
  /** Seconds, or null when the asset never reported one. */
  duration: number | null;
  /** 1-based, matching how the owner and the thread refer to it. */
  clipNumber: number;
  /** Set when a staged edit targets this clip. */
  staged: 'remove' | 'swap' | 'added' | null;
}

export interface ListBatchItemClipsResponse {
  /**
   * The list to SHOW — which is the staged one when the clip list editor has
   * staged a whole-list edit, and the stored one with per-clip markers
   * otherwise.
   *
   * The two cases differ because the two edits differ. A named `swap`/`remove`
   * is a note pinned to a cut that still exists, so the cut is what to show. A
   * relist IS the owner's new list, made by dragging the thumbnails in front of
   * them; showing the old order back would contradict the gesture they just
   * made. `pendingRelist` says which of the two you are looking at.
   */
  clips: BatchItemClip[];
  /** True when `clips` is the staged list rather than the rendered one. */
  pendingRelist: boolean;
  /** Staged on-screen text changes, summarised for display. */
  textChanges: string[];
  /** True when anything is waiting on a commit. */
  hasStagedEdits: boolean;
  /** Re-renders this item's edits have cost so far. */
  renderCount: number;
  /**
   * The cut this list describes.
   *
   * A card in the transcript records the attempt it was emitted against; when
   * this no longer matches, that card is history and must stop offering to act.
   * Every card for an item otherwise reads the same live state, so staging a
   * NEW edit brought every older card back to life offering to approve it.
   */
  attemptId: string;
}
