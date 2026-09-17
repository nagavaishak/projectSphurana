import { replaceAdCreativeRequestSchema } from '@borradh-workspace/features/meta-ads';
import { createZodDto } from 'nestjs-zod';

export class ReplaceAdCreativeDto extends createZodDto(
  replaceAdCreativeRequestSchema
) {}
