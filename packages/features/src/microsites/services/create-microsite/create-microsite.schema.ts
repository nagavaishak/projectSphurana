import { z } from 'zod';
import { micrositeThemeSchema } from '../../blocks/index.js';

/**
 * Labels that must never become a tenant's subdomain, because host resolution
 * (`resolveMicrositeHost`) reads the first label of `{slug}.borradh.io` and
 * these already mean something else on that apex — or are about to.
 */
export const RESERVED_MICROSITE_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'book',
  'booking',
  'cdn',
  'dashboard',
  'dev',
  'docs',
  'mail',
  'portal',
  'preview',
  'sites',
  'staging',
  'static',
  'status',
  'support',
  'www',
]);

/**
 * A hostname label, not a display name: lowercase, no leading/trailing dash, no
 * double dash, 2–63 chars (the DNS label limit).
 */
export const micrositeSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Slug must be at least 2 characters')
  .max(63, 'Slug must be at most 63 characters')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Slug must be lowercase letters, numbers and single dashes'
  )
  .refine((slug) => !RESERVED_MICROSITE_SLUGS.has(slug), {
    message: 'Slug is reserved',
  });

export const createMicrositeSchema = z.object({
  organizationId: z.string().min(1),
  slug: micrositeSlugSchema,
  /**
   * Optional so a caller that already seeded a theme (provisioning does, in the
   * same job) does not pay for the imagery pass twice. Omitted = seed it here.
   */
  theme: micrositeThemeSchema.optional(),
});

export type CreateMicrositeInput = z.infer<typeof createMicrositeSchema>;
