import { buyPhoneNumberSchema } from '@borradh-workspace/features/phone-numbers';
import { createZodDto } from 'nestjs-zod';

export class BuyPhoneNumberDto extends createZodDto(
  buyPhoneNumberSchema.omit({ organizationId: true })
) {}
