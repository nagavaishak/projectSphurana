import { z } from 'zod';

/**
 * Input shape for the intent classifier.
 *
 * The classifier runs on the user's first message in a conversation only —
 * the controller (W-C03-D) skips it on subsequent turns. Subsequent skill
 * pivots come from the `load_skill` tool, not re-classification.
 */
export const classifyIntentSchema = z.object({
  /** The user's first message. Bound to a sane upper length so a runaway
   *  paste doesn't drive the classifier off a cliff. */
  userMessage: z.string().min(1).max(4000),
  organizationId: z.string().min(1),
});

export type ClassifyIntentInput = z.infer<typeof classifyIntentSchema>;

/**
 * Output of the classifier.
 *
 * - `skillIds` — at least one entry; `['default']` when nothing matches or
 *   we can't reach the model. Every ID is guaranteed to resolve in the
 *   skill registry (validated before write).
 * - `confidence` — model-reported number in [0, 1]. Used by callers that
 *   want to escalate to a human review or fall back to the default skill
 *   on low confidence. The value is `0` when the classifier returned the
 *   `['default']` fallback because of a parse / unknown-ID failure.
 */
export interface ClassifyIntentOutput {
  skillIds: string[];
  confidence: number;
}
