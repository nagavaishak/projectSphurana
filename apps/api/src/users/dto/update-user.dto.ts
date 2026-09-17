import { updateUserRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateUserDto extends createZodDto(updateUserRequestSchema) {}
