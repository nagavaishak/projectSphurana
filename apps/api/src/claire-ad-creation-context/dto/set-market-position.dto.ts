import { setMarketPositionSchema } from '@borradh-workspace/features/claire';
import { createZodDto } from 'nestjs-zod';

export class SetMarketPositionDto extends createZodDto(
  setMarketPositionSchema.omit({ organizationId: true })
) {}
