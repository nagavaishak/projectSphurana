import { assignPractitionerServicesRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for replacing a practitioner's service assignments.
 *
 * DERIVED from the canonical wire contract
 * (`assignPractitionerServicesRequestBase` in `@borradh-workspace/contracts`)
 * by extending the server-injected context fields onto it: `practitionerId` is
 * the route param and `organizationId` comes from the session.
 */
export const assignPractitionerServicesSchema =
  assignPractitionerServicesRequestBase.extend({
    practitionerId: z.string().min(1, 'Practitioner ID is required'),
    organizationId: z.string().min(1, 'Organization ID is required'),
  });

export type AssignPractitionerServicesInput = z.infer<
  typeof assignPractitionerServicesSchema
>;
