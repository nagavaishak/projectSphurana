import { addPhoneNumberSchema } from '@borradh-workspace/features/phone-numbers';
import { createZodDto } from 'nestjs-zod';

export class AddPhoneNumberDto extends createZodDto(
  addPhoneNumberSchema.omit({ organizationId: true })
) {}
