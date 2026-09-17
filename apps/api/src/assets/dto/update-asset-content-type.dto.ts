import { updateAssetContentTypeSchema } from '@borradh-workspace/features/assets';
import { createZodDto } from 'nestjs-zod';

export class UpdateAssetContentTypeDto extends createZodDto(
  updateAssetContentTypeSchema.omit({ assetId: true, organizationId: true })
) {}
