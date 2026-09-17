/**
 * Slot-based video clip configuration
 *
 * Slots are built dynamically from the randomly selected variation's clipGuidance.
 * The `order` field links a frontend slot to the backend clip guidance entry.
 *
 * Template slots support multi-select (maxCount: 5) so users can upload
 * multiple videos per section (e.g. multiple before/after clips).
 * The DEFAULT_SLOTS fallback is used for unknown templates (generic multi-select b-roll).
 */

import type { TemplateClipGuidance } from '@borradh-workspace/features/videos/templates';

export type ClipType = 'before' | 'after' | 'bRoll';

export interface SlotConfig {
  /** Clip type identifier */
  type: ClipType;
  /** Display label for the slot */
  label: string;
  /** Help text describing what to upload */
  description: string;
  /** Whether this slot is required to submit */
  required: boolean;
  /** Maximum number of clips (1 for single select, >1 for multi) */
  maxCount: number;
  /**
   * Ordering key that links to clipGuidance.order in template-definitions.
   * When defined, this slot is stored in clips.templateSlots[order] as an
   * array of asset IDs (multi-select when maxCount > 1).
   */
  order?: number;
  /** Default tag filter for this slot's media selection step */
  filterTag?: string;
}

/**
 * Default slot configuration for unknown templates (generic multi-select b-roll)
 */
const DEFAULT_SLOTS: SlotConfig[] = [
  {
    type: 'bRoll',
    label: 'Background Footage',
    description: 'B-roll clips to show during your video',
    required: false,
    maxCount: 5,
  },
];

/**
 * Determine the clip type for a slot based on template and order.
 * Before-after templates use 'before' for order 1, 'after' for the last slot.
 * All other templates use 'bRoll' for every slot.
 */
function getClipTypeForSlot(
  templateId: string,
  order: number,
  totalSlots: number
): ClipType {
  if (templateId === 'before-after') {
    if (order === 1) return 'before';
    if (order === totalSlots) return 'after';
  }
  return 'bRoll';
}

/**
 * Build slot configs dynamically from a variation's clipGuidance.
 * This uses the randomly selected variation's labels instead of hardcoded defaults.
 *
 * @param templateId - Template category (e.g., "authority", "before-after")
 * @param clipGuidance - The selected variation's clipGuidance array
 * @returns SlotConfig[] with labels from the variation
 */
export function buildSlotsFromClipGuidance(
  templateId: string,
  clipGuidance: TemplateClipGuidance[],
  narrationMode: 'recorded' | 'ai_voiceover' | 'text_only' = 'recorded'
): SlotConfig[] {
  if (narrationMode === 'ai_voiceover' || narrationMode === 'text_only') {
    // For AI voiceover and text-only, use the clip guidance if available
    // (they still need b-roll footage), but fall back to defaults
    if (!clipGuidance || clipGuidance.length === 0) {
      return DEFAULT_SLOTS;
    }
    // Use clip guidance slots for text-only/AI so user still picks ordered footage
    // At least the first slot is required so the video has footage
    const sorted = [...clipGuidance].sort((a, b) => a.order - b.order);
    return sorted.map((guidance, index) => ({
      type: 'bRoll' as ClipType,
      label: guidance.label,
      description: guidance.description,
      required: index === 0,
      maxCount: 5,
      order: guidance.order,
      filterTag: guidance.filterTag,
    }));
  }

  if (!clipGuidance || clipGuidance.length === 0) {
    return DEFAULT_SLOTS;
  }

  const sorted = [...clipGuidance].sort((a, b) => a.order - b.order);
  const total = sorted.length;

  return sorted.map((guidance, index) => {
    const clipType = getClipTypeForSlot(templateId, guidance.order, total);
    return {
      type: clipType,
      label: guidance.label,
      description: guidance.description,
      required: clipType === 'before' || clipType === 'after' || index === 0,
      maxCount: 5,
      order: guidance.order,
      filterTag: guidance.filterTag,
    };
  });
}

/**
 * Get the default slot configuration (generic b-roll multi-select).
 * Used as fallback when no variation clipGuidance is available.
 */
export function getDefaultSlots(): SlotConfig[] {
  return DEFAULT_SLOTS;
}
