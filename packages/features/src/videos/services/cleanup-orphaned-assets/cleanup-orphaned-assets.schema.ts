import { z } from 'zod';

export const cleanupOrphanedAssetsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Dry run mode — lists orphaned assets without deleting */
  dryRun: z.boolean().default(false),
  /** Only clean up assets older than this many hours (prevents deleting active session uploads) */
  minAgeHours: z.number().min(0).default(24),
});

export type CleanupOrphanedAssetsInput = z.input<
  typeof cleanupOrphanedAssetsSchema
>;
