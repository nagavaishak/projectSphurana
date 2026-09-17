import { z } from 'zod';

/**
 * Input for `saveContentRule`.
 *
 * `title` is the chip label; `content` is the sentence that goes into the
 * prompt. They are usually near-identical — the split exists so a long rule
 * ("never imply a treatment is permanent, our results are 12-18 months") can
 * still show as a short chip.
 *
 * `batchId` is provenance only: it records which review session taught us this,
 * which is the first thing you want when a rule turns out to be wrong.
 */
export const saveContentRuleSchema = z.object({
  organizationId: z.string().min(1),
  title: z.string().min(1).max(80),
  content: z.string().min(1).max(280),
  batchId: z.string().min(1).optional(),
});

export type SaveContentRuleInput = z.infer<typeof saveContentRuleSchema>;

export interface SaveContentRuleOutput {
  id: string;
}
