import { resolveDisagreementSchema } from '@borradh-workspace/features/claire';
import { createZodDto } from 'nestjs-zod';

export class ResolveDisagreementDto extends createZodDto(
  resolveDisagreementSchema.omit({ organizationId: true })
) {}
