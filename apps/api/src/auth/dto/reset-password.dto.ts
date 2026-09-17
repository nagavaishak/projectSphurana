import { resetPasswordSchema } from '@borradh-workspace/features/auth';
import { createZodDto } from 'nestjs-zod';

export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
