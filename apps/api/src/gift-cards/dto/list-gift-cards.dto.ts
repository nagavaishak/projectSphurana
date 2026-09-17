import { listGiftCardsSchema } from '@borradh-workspace/features/gift-cards';
import { createZodDto } from 'nestjs-zod';

export class ListGiftCardsDto extends createZodDto(
  listGiftCardsSchema.omit({ organizationId: true })
) {}
