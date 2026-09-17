import { searchSmsNumbersSchema } from '@borradh-workspace/features/campaigns';
import { createZodDto } from 'nestjs-zod';

export class SearchSmsNumbersDto extends createZodDto(
  searchSmsNumbersSchema.omit({ organizationId: true })
) {}
