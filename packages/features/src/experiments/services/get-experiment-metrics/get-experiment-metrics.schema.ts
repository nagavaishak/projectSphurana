import { z } from 'zod';

export const getExperimentMetricsSchema = z.object({
  experimentKey: z.string().min(1, 'Experiment key is required'),
});

export type GetExperimentMetricsInput = z.infer<
  typeof getExperimentMetricsSchema
>;
