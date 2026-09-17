import { z } from 'zod';

/**
 * Schema for getting an organization by ID
 */
export const getOrganizationSchema = z.object({
  // `.min(1)` (not `.uuid()`) to match getOrganizationBrandSchema and stay
  // robust to the org-id format: the id is a lookup key (the query 404s if it
  // doesn't resolve), not security-sensitive input, and better-auth's id format
  // is not guaranteed to be a UUID.
  id: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type GetOrganizationInput = z.infer<typeof getOrganizationSchema>;
