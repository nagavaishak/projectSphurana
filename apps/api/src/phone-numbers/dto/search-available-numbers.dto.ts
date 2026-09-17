import { searchAvailableNumbersSchema } from '@borradh-workspace/features/phone-numbers';
import { createZodDto } from 'nestjs-zod';

export class SearchAvailableNumbersDto extends createZodDto(
  searchAvailableNumbersSchema
) {}
