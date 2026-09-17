import { z } from 'zod';

/**
 * Schema for getting organization members
 */
export const getOrganizationMembersSchema = z.object({
  // `.min(1)` (not `.uuid()`) to match getOrganizationBrandSchema — the id is a
  // lookup key (404s if unresolved), and better-auth's id format is not
  // guaranteed to be a UUID.
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type GetOrganizationMembersInput = z.infer<
  typeof getOrganizationMembersSchema
>;
