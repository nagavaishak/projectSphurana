import {
  socialPlatformValues,
  socialPostMediaTypeValues,
  socialPostStatusValues,
} from '@borradh-workspace/labels';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Enums are DERIVED from the labels vocabulary.
const listSocialPostsQuerySchema = z.object({
  status: z.enum(socialPostStatusValues).optional(),
  platform: z.enum(socialPlatformValues).optional(),
  mediaType: z.enum(socialPostMediaTypeValues).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export class ListSocialPostsDto extends createZodDto(
  listSocialPostsQuerySchema
) {}
