import { listFaceGroupsSchema } from '@borradh-workspace/features/face-groups';
import { createZodDto } from 'nestjs-zod';

export class ListFaceGroupsDto extends createZodDto(
  listFaceGroupsSchema.omit({ organizationId: true })
) {}
