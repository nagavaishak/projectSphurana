import { appleNativeSignInSchema } from '@borradh-workspace/features/auth';
import { createZodDto } from 'nestjs-zod';

export class AppleNativeSignInDto extends createZodDto(
  appleNativeSignInSchema
) {}
