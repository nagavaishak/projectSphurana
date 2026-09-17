import { verifyEmailSchema } from '@borradh-workspace/features/auth';
import { createZodDto } from 'nestjs-zod';

export class VerifyEmailDto extends createZodDto(verifyEmailSchema) {}
