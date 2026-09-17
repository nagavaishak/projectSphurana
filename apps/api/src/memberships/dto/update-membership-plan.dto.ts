import { updateMembershipPlanSchema } from '@borradh-workspace/features/memberships';
import { createZodDto } from 'nestjs-zod';

export class UpdateMembershipPlanDto extends createZodDto(
  updateMembershipPlanSchema.omit({ organizationId: true, planId: true })
) {}
