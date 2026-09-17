import { z } from 'zod';
import {
  ORGANIC_TEMPLATE_IDS,
  type OrganicTemplateId,
} from '../../templates/template-definitions.js';

/**
 * Organic-template IDs the planner can request a `VideoIdea` for, derived from
 * the single source of truth (`ORGANIC_TEMPLATE_IDS` in
 * `template-definitions.ts`). Deriving — rather than re-listing — means a new
 * organic template can't silently bypass idea-gen: the tuple, the runtime
 * guard, and the `TEMPLATE_FORMAT_HINTS` Record keyed by `OrganicTemplateId`
 * all move together.
 */
export const organicTemplateIdSchema = z.enum(ORGANIC_TEMPLATE_IDS);

export type { OrganicTemplateId };

export const generateVideoIdeaSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  templateId: organicTemplateIdSchema,
  serviceId: z.string().min(1, 'Service ID is required'),
});

export type GenerateVideoIdeaInput = z.infer<typeof generateVideoIdeaSchema>;

/**
 * Trim + soft-clip an AI string field to `max` chars at a word boundary.
 *
 * The idea blob is only ever a PLANNING seed — it feeds `generateOrganicCopy`
 * and `generatePostCaption` as context and is never rendered on-screen
 * verbatim (the on-screen copy is generated separately). gpt-4o routinely
 * overshoots tight length caps, and because `extractJson` validates with a
 * single `safeParse` and DOESN'T retry, a hard `.max()` reject killed the
 * whole video slot (→ no video seeded). Clipping in a `.transform()` keeps
 * the blob bounded without ever failing the slot on verbosity alone. The
 * `min` floors stay as hard validation (a too-short field is a genuine
 * quality miss, and rare).
 */
const clampedIdeaText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .transform((s) => {
      if (s.length <= max) return s;
      const slice = s.slice(0, max);
      const lastSpace = slice.lastIndexOf(' ');
      // Prefer a word boundary, but only if it doesn't chop off too much.
      return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trim();
    });

/**
 * Runtime output schema for one slot's `VideoIdea`. Field shape MUST stay
 * aligned with the `VideoIdea` interface exported from
 * `@borradh-workspace/database` (see `packages/database/src/schema/content-batch.ts`).
 * Caps are generous (the model usually fits) with `clampedIdeaText` as the
 * safety net so an over-long field is clipped, never rejected.
 */
export const videoIdeaSchema = z.object({
  topic: clampedIdeaText(30, 220),
  angle: clampedIdeaText(20, 140),
  payoff: clampedIdeaText(20, 160),
  audience: clampedIdeaText(10, 90),
  serviceName: clampedIdeaText(1, 80),
});

export type VideoIdeaOutput = z.infer<typeof videoIdeaSchema>;
