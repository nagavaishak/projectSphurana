import { z } from 'zod';
import { micrositeRevisionAuthorSchema } from '../create-revision/index.js';

export const publishMicrositeSchema = z.object({
  micrositeId: z.string().min(1),
  /** The caller's active org. Enforced here, not in the controller (plan §12). */
  organizationId: z.string().min(1),
  label: z.string().trim().min(1).max(200).optional(),
  /** Who pressed publish. Provisioning publishes as `system`. */
  createdBy: micrositeRevisionAuthorSchema.default('user'),
});

export type PublishMicrositeInput = z.input<typeof publishMicrositeSchema>;
