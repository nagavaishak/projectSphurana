import { createManualPairSchema } from '@borradh-workspace/features/face-groups';
import { createZodDto } from 'nestjs-zod';

export class CreateManualPairDto extends createZodDto(
  createManualPairSchema.omit({ organizationId: true })
) {}
