import { z } from 'zod';

/**
 * Schema for completing the Meta Ads setup wizard
 */
export const connectMetaAdsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  userId: z.string().min(1, 'User ID is required'),
  code: z.string().min(1, 'Authorization code is required'),
  // Wizard selections
  adAccountId: z.string().min(1, 'Ad account ID is required'),
  adAccountName: z.string().optional(),
  pageId: z.string().min(1, 'Page ID is required'),
  pageName: z.string().optional(),
  platform: z.enum(['facebook', 'instagram']).default('facebook'),
  // Optional pixel selection
  pixelId: z.string().optional(),
  pixelName: z.string().optional(),
});

export type ConnectMetaAdsInput = z.infer<typeof connectMetaAdsSchema>;

/**
 * Schema for initiating Meta OAuth (returns temp session for wizard)
 */
export const initiateMetaOAuthSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  userId: z.string().min(1, 'User ID is required'),
  code: z.string().min(1, 'Authorization code is required'),
  // When true, `code` came from the Facebook Login for Business popup
  // (redirect-less) and is exchanged in one call for a non-expiring
  // system-user token. When omitted/false, the classic redirect flow's
  // short→long-lived two-step exchange is used. Optional (not defaulted) so
  // existing callers that omit it stay valid; undefined is treated as false.
  flfb: z.boolean().optional(),
});

export type InitiateMetaOAuthInput = z.infer<typeof initiateMetaOAuthSchema>;
