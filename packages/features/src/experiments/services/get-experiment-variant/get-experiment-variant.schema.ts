import { z } from 'zod';

export const getExperimentVariantSchema = z.object({
  experimentKey: z.string().min(1, 'Experiment key is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetExperimentVariantInput = z.infer<
  typeof getExperimentVariantSchema
>;
