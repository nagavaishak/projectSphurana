import { updateSegmentRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `PUT campaigns/segments/:id`. */
export class UpdateSegmentDto extends createZodDto(
  updateSegmentRequestSchema
) {}
