import { z } from 'zod';

export const provisionMicrositeSchema = z.object({
  organizationId: z.string().min(1),
});

export type ProvisionMicrositeInput = z.infer<typeof provisionMicrositeSchema>;

/**
 * The ONLY thing the model is allowed to produce.
 *
 * Note what is NOT here: service names, prices, practitioner names, opening
 * hours, addresses. Those live in data-bound blocks that hold a QUERY (plan
 * §5), so the model writes the framing prose and the business data stays live.
 * A per-service blurb was deliberately dropped for the same reason — there is
 * nowhere to persist one that would not denormalise `organization_service`
 * into `blocks` jsonb and go stale the first time a service is renamed. The
 * services section gets ONE intro instead.
 *
 * Every field is length-bounded: this text is rendered on a public page and an
 * unbounded model response is an unbounded `<h1>`.
 */
export const micrositeCopySchema = z.object({
  heroHeadline: z.string().trim().min(1).max(90),
  heroSubheadline: z.string().trim().min(1).max(220),
  /** Sanitized markdown subset — never raw HTML (see the rich_text contract). */
  aboutMarkdown: z.string().trim().min(1).max(2000),
  servicesIntro: z.string().trim().min(1).max(400),
  ctaHeadline: z.string().trim().min(1).max(90),
  ctaSubtext: z.string().trim().min(1).max(220),
  contactIntro: z.string().trim().min(1).max(400),
});

export type MicrositeCopy = z.infer<typeof micrositeCopySchema>;
