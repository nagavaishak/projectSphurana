import {
  commitmentLevelValues,
  marketPositionValues,
  retentionModelValues,
} from '@borradh-workspace/database';
import { z } from 'zod';

export const setAxisOverrideSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  axes: z
    .object({
      retentionModel: z.enum(retentionModelValues).optional(),
      commitmentLevel: z.enum(commitmentLevelValues).optional(),
      marketPosition: z.enum(marketPositionValues).optional(),
    })
    .refine(
      (axes) =>
        axes.retentionModel !== undefined ||
        axes.commitmentLevel !== undefined ||
        axes.marketPosition !== undefined,
      { message: 'At least one axis must be overridden' }
    ),
});

export type SetAxisOverrideInput = z.infer<typeof setAxisOverrideSchema>;
