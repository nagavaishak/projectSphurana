import { generateOfferContentRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see `packages/contracts/src/requests/
 * content.ts`.
 */
export const generateOfferContentSchema =
  generateOfferContentRequestBase.extend({
    organizationId: z.string().min(1, 'Organization ID is required'),
  });

export type GenerateOfferContentInput = z.infer<
  typeof generateOfferContentSchema
>;
