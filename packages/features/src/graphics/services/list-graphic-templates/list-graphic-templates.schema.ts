import { z } from 'zod';

export const listGraphicTemplatesSchema = z.object({
  /**
   * Which template pool to list. organic = social-post styles (the dialog's
   * style picker), ad = paid offer layouts. Defaults to organic.
   */
  usageType: z.enum(['organic', 'ad']).default('organic'),
});

export type ListGraphicTemplatesInput = z.input<
  typeof listGraphicTemplatesSchema
>;
