import { z } from 'zod';

export const resolveOrgPixelSchema = z.object({
  organizationId: z.string().min(1),
  /** Internal `metaAdsPage.id`. Falls back to the integration's default page. */
  metaAdsPageId: z.string().min(1).optional().nullable(),
  /** Name used only when a pixel genuinely has to be created. */
  pixelName: z.string().min(1).max(100).optional(),
  /**
   * Ignore the stored pixel id and re-read from Meta. For the repair path —
   * a pixel deleted in Events Manager leaves a stale id on our row.
   */
  forceRefresh: z.boolean().optional(),
});

export type ResolveOrgPixelInput = z.infer<typeof resolveOrgPixelSchema>;
