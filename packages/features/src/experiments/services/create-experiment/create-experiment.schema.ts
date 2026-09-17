import { experimentStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';

const variantConfigSchema = z.record(
  z.string(),
  z.object({
    label: z.string().min(1),
    weight: z.number().min(0).max(100),
  })
);

export const createExperimentSchema = z.object({
  key: z.string().min(1, 'Key is required').max(100),
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
  variants: variantConfigSchema.refine(
    (v) => {
      const weights = Object.values(v).reduce((sum, c) => sum + c.weight, 0);
      return Math.abs(weights - 100) < 0.01;
    },
    { message: 'Variant weights must sum to 100' }
  ),
  status: z.enum(experimentStatusValues).default('active'),
  posthogFeatureKey: z.string().optional(),
});

export type CreateExperimentInput = z.infer<typeof createExperimentSchema>;
