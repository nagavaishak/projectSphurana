/**
 * AiGeneratedSource — v1 implementation of `SlotImageSource`.
 *
 * Always returns a `{ kind: 'generate', prompt }` resolution. The planner
 * supplies the per-slide image prompts up-front (one Claude call per template
 * produces both text fills AND image prompts), so this source's job is to
 * surface those pre-baked prompts as `SlotImageResolution`s during slot-fill
 * assembly.
 *
 * If no prebuilt prompt was provided for a slot, we fall back to the slot's
 * `subjectGuidance` from the template (so callers that don't pre-plan still
 * get a usable prompt). If neither exists, we emit a minimal generic prompt
 * — better to render *something* than to crash the whole batch.
 *
 * Future siblings (`BusinessAssetSource`) will check `PlanContext` and
 * resolve to `{ kind: 'asset', url }` when a real business asset is
 * available. They will share this interface so the planner doesn't change.
 */

import type {
  ImageSlot,
  PlanContext,
  SlotImageResolution,
  SlotImageSource,
} from '../types.js';

/**
 * Options for constructing an `AiGeneratedSource`.
 *
 * `promptsBySlotId` is a precomputed map: the planner's Claude call decided
 * up front what image prompt to use for each image slot. Keys are slot IDs
 * (e.g. `bgImage`); values are the natural-language prompts to send to the
 * batch renderer.
 *
 * Carousels have repeating slot IDs across slides (`bgImage` appears on
 * every slide), so callers must build a per-slide source if they need
 * per-slide prompts — the source itself is stateless beyond its prompt map.
 */
export interface AiGeneratedSourceOptions {
  promptsBySlotId?: Record<string, string>;
}

/**
 * Build a `SlotImageSource` that returns generation prompts.
 *
 * Returns the function-style impl directly — the interface is a single
 * method, so a factory keeps the call-site clean (`source.resolve(slot, ctx)`)
 * without forcing a class for one method.
 */
export function createAiGeneratedSource(
  options: AiGeneratedSourceOptions = {}
): SlotImageSource {
  const prompts = options.promptsBySlotId ?? {};

  return {
    async resolve(
      slot: ImageSlot,
      _ctx: PlanContext
    ): Promise<SlotImageResolution> {
      if (slot.kind !== 'image') {
        // Defensive: callers should only invoke a SlotImageSource for image
        // slots. If they do anyway, fall back to a no-op asset placeholder
        // rather than crash.
        return { kind: 'asset', url: '' };
      }

      const fromPlanner = prompts[slot.id];
      if (fromPlanner && fromPlanner.trim().length > 0) {
        return { kind: 'generate', prompt: fromPlanner };
      }

      // No planner-supplied prompt — derive from the template's authoring
      // guidance. This is a fallback path; production code should always
      // route through Claude so the prompt incorporates the topic.
      const guidance = slot.subjectGuidance?.trim();
      if (guidance) {
        return { kind: 'generate', prompt: guidance };
      }

      return {
        kind: 'generate',
        prompt:
          'soft, abstract background imagery, gentle palette, no text or watermarks',
      };
    },
  };
}
