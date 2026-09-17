import { generateGraphicFromServiceRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see
 * `generateGraphicFromServiceRequestBase` in
 * `packages/contracts/src/requests/content.ts`, where the image-sourcing
 * switches and their defaults are documented.
 */
export const generateGraphicFromServiceSchema =
  generateGraphicFromServiceRequestBase.extend({
    organizationId: z.string().min(1, 'organizationId is required'),
  });

export type GenerateGraphicFromServiceInput = z.infer<
  typeof generateGraphicFromServiceSchema
>;
