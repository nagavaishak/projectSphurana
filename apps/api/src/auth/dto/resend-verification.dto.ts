import { resendVerificationSchema } from '@borradh-workspace/features/auth';
import { createZodDto } from 'nestjs-zod';

export class ResendVerificationDto extends createZodDto(
  resendVerificationSchema
) {}
