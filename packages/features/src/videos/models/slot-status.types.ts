/**
 * Slot-based video clip status types
 *
 * Used to track which clips have been uploaded for a video template.
 * Mobile app uses these to show upload progress and guide users
 * through uploading required clips.
 */

/**
 * Represents a single clip slot in a video
 */
export interface ClipSlot {
  /** Type of clip: talking head or b-roll */
  type: 'talkingHead' | 'bRoll';
  /** Order in the template (0 = talking head, 1+ = b-roll from clipGuidance) */
  order: number;
  /** Display label for the slot (e.g., "Talking Head", "Before", "After") */
  label: string;
  /** Description of what content to upload */
  description: string;
  /** Filled clip info if uploaded, null if empty. assetId may be null for camera-recorded clips. */
  filled: { assetId: string | null; url?: string } | null;
}

/**
 * Full slot status for a video
 * Used by mobile app to display upload progress
 */
export interface VideoSlotStatus {
  /** Video ID */
  videoId: string;
  /** Video title */
  title: string;
  /** Template variation ID if using a template */
  variationId: string | null;
  /** All clip slots (talking head + b-roll) */
  slots: ClipSlot[];
  /** Whether all required slots are filled */
  isComplete: boolean;
  /** Script content from draftConfig (hook, body, cta) */
  script: {
    hook?: string;
    body?: string;
    cta?: string;
    fullText: string;
  } | null;
  /** Video thumbnail URL if available */
  thumbnailUrl: string | null;
}

/**
 * Summary of slot completion (lighter weight for list views)
 */
export interface VideoSlotSummary {
  /** Total number of required slots */
  totalRequired: number;
  /** Number of slots that have been filled */
  filled: number;
  /** Whether the talking head slot needs to be recorded */
  needsTalkingHead: boolean;
}

/**
 * In-progress video with slot summary
 * Used by list-in-progress-videos endpoint
 */
export interface InProgressVideo {
  id: string;
  title: string;
  status: string;
  variationId: string | null;
  templateId: string | null;
  thumbnailUrl: string | null;
  createdAt: Date;
  /** Slot completion summary */
  slotSummary: VideoSlotSummary;
}
