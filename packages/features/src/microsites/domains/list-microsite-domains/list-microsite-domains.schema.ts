import { z } from 'zod';

export const listMicrositeDomainsSchema = z.object({
  micrositeId: z.string().min(1),
  /** The caller's active org. Enforced in the SERVICE, not the controller. */
  organizationId: z.string().min(1),
  /**
   * `removed` rows are tombstones — kept so a hostname is never silently
   * re-issued to a different tenant. They are noise in the settings UI, so they
   * are excluded unless a caller explicitly asks (support, audit).
   */
  includeRemoved: z.boolean().default(false),
});

export type ListMicrositeDomainsInput = z.input<
  typeof listMicrositeDomainsSchema
>;
