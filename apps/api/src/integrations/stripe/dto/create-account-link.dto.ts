import { createAccountLinkRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateAccountLinkDto extends createZodDto(
  createAccountLinkRequestSchema
) {}
