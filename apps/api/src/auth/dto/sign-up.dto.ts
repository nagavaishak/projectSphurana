import { signUpSchema } from '@borradh-workspace/features/auth';
import { createZodDto } from 'nestjs-zod';

export class SignUpDto extends createZodDto(signUpSchema) {}
