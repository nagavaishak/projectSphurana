import { previewSegmentRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `POST campaigns/segments/preview`. */
export class PreviewSegmentDto extends createZodDto(
  previewSegmentRequestSchema
) {}
