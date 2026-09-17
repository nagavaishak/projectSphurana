import { externalRedirectUrl } from '@borradh-workspace/contracts';
import { z } from 'zod';

export const createPortalSessionSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  returnUrl: externalRedirectUrl,
});

export type CreatePortalSessionInput = z.infer<
  typeof createPortalSessionSchema
>;
