import { listOffersSchema } from '@borradh-workspace/features/offers';
import { createZodDto } from 'nestjs-zod';

export class ListOffersDto extends createZodDto(
  listOffersSchema.omit({ organizationId: true })
) {}
