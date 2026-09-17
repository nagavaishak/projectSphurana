import { z } from 'zod';

/**
 * Input for `listContentRules`.
 *
 * Org-scoped only — content rules are deliberately org-wide (`user_id IS
 * NULL`). A personal "less salesy" would mean two people in the same clinic
 * generating different copy from the same button, which nobody expects.
 */
export const listContentRulesSchema = z.object({
  organizationId: z.string().min(1),
});

export type ListContentRulesInput = z.infer<typeof listContentRulesSchema>;

export interface ContentRule {
  id: string;
  /** Short label for the chip, e.g. "Mention the €50 deposit". */
  title: string;
  /** The instruction as it goes into the prompt. */
  content: string;
  createdAt: string;
}

export interface ListContentRulesOutput {
  items: ContentRule[];
}
