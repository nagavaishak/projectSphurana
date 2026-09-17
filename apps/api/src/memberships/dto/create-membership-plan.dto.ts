import { createMembershipPlanSchema } from '@borradh-workspace/features/memberships';
import { createZodDto } from 'nestjs-zod';

export class CreateMembershipPlanDto extends createZodDto(
  createMembershipPlanSchema.omit({ organizationId: true })
) {}
