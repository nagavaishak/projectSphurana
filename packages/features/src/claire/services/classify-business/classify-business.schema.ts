import {
  businessVerticalValues,
  marketPositionValues,
} from '@borradh-workspace/database';
import { z } from 'zod';

export const classifyBusinessSchema = z.object({
  organizationId: z.string().min(1),
  // Bypass the inputHash + classifierVersion short-circuit. Used by the
  // override mutation and the onboarding trigger to guarantee a fresh run.
  force: z.boolean().optional(),
  ownerSelfReport: z
    .object({
      vertical: z.enum(businessVerticalValues).optional(),
      marketPosition: z.enum(marketPositionValues).optional(),
    })
    .optional(),
  // Optional source attribution for telemetry. Callers should set this so
  // the `claire.classifier.run` event records what triggered the run.
  // Defaults to 'unknown' so the schema stays backward-compatible.
  reason: z
    .enum(['onboarding', 'services_changed', 'override', 'backfill', 'force'])
    .optional(),
});

export type ClassifyBusinessInput = z.infer<typeof classifyBusinessSchema>;
