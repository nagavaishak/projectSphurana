import { unlinkAssetServicesSchema } from '@borradh-workspace/features/assets';
import { createZodDto } from 'nestjs-zod';

// Body-only DTO: assetId and organizationId come from the route param and
// the active organization, so they're omitted here. The `serviceIds` array
// is required (min 1) — this guards against undefined/empty bodies that
// previously reached the service and threw a TypeError on `.length`.
export class UnlinkAssetServicesDto extends createZodDto(
  unlinkAssetServicesSchema.pick({ serviceIds: true })
) {}
