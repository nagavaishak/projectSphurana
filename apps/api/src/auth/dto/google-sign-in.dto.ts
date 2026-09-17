import { googleSignInSchema } from '@borradh-workspace/features/auth';
import { createZodDto } from 'nestjs-zod';

export class GoogleSignInDto extends createZodDto(googleSignInSchema) {}
