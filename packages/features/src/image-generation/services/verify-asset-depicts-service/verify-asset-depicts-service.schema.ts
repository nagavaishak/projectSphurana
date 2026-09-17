import { z } from 'zod';

export const verifyAssetDepictsServiceSchema = z.object({
  /** The asset's bytes — a still, or a video's thumbnail frame. */
  image: z.instanceof(Buffer),
  /** The service the asset is filed under, as the owner named it. */
  serviceName: z.string().min(1),
  /**
   * The service record's notes, for judging only.
   *
   * A service name alone can be opaque — "Princess Peel", "Nue Conceal" — and
   * the judge needs to know what the treatment involves before it can say a
   * photograph shows something else. This never reaches a render: the renderer
   * deliberately no longer receives the description at all, because owners put
   * marketing copy and prices in it and the model drew them.
   */
  serviceDescription: z.string().optional(),
});

export type VerifyAssetDepictsServiceInput = z.input<
  typeof verifyAssetDepictsServiceSchema
>;
