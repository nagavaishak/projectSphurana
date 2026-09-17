import { updateFaceGroupAssetRoleSchema } from '@borradh-workspace/features/face-groups';
import { createZodDto } from 'nestjs-zod';

export class UpdateFaceGroupAssetRoleDto extends createZodDto(
  updateFaceGroupAssetRoleSchema.omit({
    faceGroupId: true,
    assetId: true,
    organizationId: true,
  })
) {}
