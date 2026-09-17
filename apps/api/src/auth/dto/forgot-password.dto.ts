import { forgotPasswordSchema } from '@borradh-workspace/features/auth';
import { createZodDto } from 'nestjs-zod';

export class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}
