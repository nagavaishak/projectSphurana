import { z } from 'zod';

/**
 * Schema for syncing a lead form to Meta
 */
export const syncLeadFormToMetaSchema = z.object({
  leadFormId: z.string().min(1, 'Lead form ID is required'),
  // Optional: scopes the form lookup for access control. When supplied, a form
  // belonging to another organization is indistinguishable from a missing one
  // (NOT_FOUND) and nothing is synced or written for it.
  organizationId: z.string().optional(),
  // Optional: override the page to sync to
  metaPageId: z.string().optional(),
});

/**
 * Input type inferred from schema
 */
export type SyncLeadFormToMetaInput = z.infer<typeof syncLeadFormToMetaSchema>;
