import { z } from 'zod';

export const getMicrositeDocumentSchema = z.object({
  micrositeId: z.string().min(1),
  /** The caller's active org. Enforced here, not in the controller (plan §12). */
  organizationId: z.string().min(1),
  /**
   * `draft` reads the working `microsite_page` rows (the editor and the signed
   * preview). `published` reads the immutable revision snapshot — the ONLY
   * thing the public is ever served.
   */
  mode: z.enum(['draft', 'published']).default('draft'),
});

export type GetMicrositeDocumentInput = z.input<
  typeof getMicrositeDocumentSchema
>;
