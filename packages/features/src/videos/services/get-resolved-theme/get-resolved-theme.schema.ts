import { themeOverridesSchema } from '@borradh-workspace/video-templates';
import { z } from 'zod';

// Input schema for getResolvedTheme.
//
// The synthesizer passes in the active organization and optional per-video
// theme overrides. The service merges:
//
//   engineDefaultTheme  →  brandKit (org)  →  themeOverrides (this input)
//                                                       ↓
//                                              resolved Theme
//
export const getResolvedThemeSchema = z.object({
  organizationId: z.string().min(1),
  /**
   * Per-video override. Takes precedence over the org's brand_kit. Any
   * branch left undefined falls through to the brand_kit / engine default.
   */
  themeOverrides: themeOverridesSchema.optional(),
});

export type GetResolvedThemeInput = z.infer<typeof getResolvedThemeSchema>;
