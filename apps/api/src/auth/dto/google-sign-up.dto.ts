import { googleSignUpSchema } from '@borradh-workspace/features/auth';
import { createZodDto } from 'nestjs-zod';

export class GoogleSignUpDto extends createZodDto(googleSignUpSchema) {}
