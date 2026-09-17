import { updateWageConfigRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see
 * `packages/contracts/src/requests/scheduling.ts`.
 */
export const updateWageConfigSchema = updateWageConfigRequestBase.extend({
  organizationId: z.string().min(1),
  /** Route param on `PUT /wage-configs/:practitionerId`. */
  practitionerId: z.string().min(1),
});

export type UpdateWageConfigInput = z.infer<typeof updateWageConfigSchema>;
