import { createSegmentRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `POST campaigns/segments`. */
export class CreateSegmentDto extends createZodDto(
  createSegmentRequestSchema
) {}
