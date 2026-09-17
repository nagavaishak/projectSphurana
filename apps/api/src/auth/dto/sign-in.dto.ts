import { signInSchema } from '@borradh-workspace/features/auth';
import { createZodDto } from 'nestjs-zod';

export class SignInDto extends createZodDto(signInSchema) {}
