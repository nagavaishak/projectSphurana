import { z } from 'zod';

export const registerSelfServeMetaConnectionSchema = z.object({
  /** Authorization code from the FLfB redirect. */
  code: z.string().min(1),
});

export type RegisterSelfServeMetaConnectionInput = z.infer<
  typeof registerSelfServeMetaConnectionSchema
>;
