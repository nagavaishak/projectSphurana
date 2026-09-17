import { updateGraphicSchema } from '@borradh-workspace/features/graphics';
import { createZodDto } from 'nestjs-zod';

export class UpdateGraphicDto extends createZodDto(
  updateGraphicSchema.omit({ id: true, organizationId: true })
) {}
