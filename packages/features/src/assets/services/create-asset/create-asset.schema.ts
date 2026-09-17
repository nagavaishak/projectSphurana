import { createAssetRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Create Asset Input Schema.
 *
 * DERIVED from the wire contract — see `createAssetRequestBase` in
 * `packages/contracts/src/requests/content.ts`.
 */
export const createAssetInputSchema = createAssetRequestBase.extend({
  organizationId: z.string(),
  uploadedById: z.string(),
});

export type CreateAssetInput = z.input<typeof createAssetInputSchema>;
