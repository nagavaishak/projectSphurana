import { z } from 'zod';

export const classifyServiceTechniqueSchema = z.object({
  organizationServiceId: z.string().min(1),
  /**
   * Re-classify a row that already carries `techniqueClassifiedAt`.
   *
   * Off by default so the matcher can call this on every job without paying for
   * two LLM calls each time. The update path sets it, because a renamed or
   * re-described service is a genuinely different question.
   */
  force: z.boolean().optional().default(false),
});

export type ClassifyServiceTechniqueInput = z.input<
  typeof classifyServiceTechniqueSchema
>;
