import { z } from 'zod';

/**
 * Attribution as it arrives from the microsite: either a landing URL to parse,
 * explicit UTMs, or both (explicit wins, because a caller that bothered to pass
 * them has better information than a URL we are re-reading).
 */
export const attachLeadAttributionSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  leadId: z.string().min(1, 'Lead ID is required'),
  /**
   * The site this lead came from. NOT the host — see `utm.ts`. Optional only
   * because a lead can carry UTMs without a microsite (a legacy landing page).
   */
  micrositeId: z.string().min(1).optional(),
  /** The full URL the visitor landed on, UTMs and all. */
  landingUrl: z.string().min(1).optional(),
  utmSource: z.string().min(1).optional(),
  utmMedium: z.string().min(1).optional(),
  utmCampaign: z.string().min(1).optional(),
  utmContent: z.string().min(1).optional(),
  utmTerm: z.string().min(1).optional(),
});

export type AttachLeadAttributionInput = z.infer<
  typeof attachLeadAttributionSchema
>;
