import { changeEmailSchema } from '@borradh-workspace/features/auth';
import { createZodDto } from 'nestjs-zod';

/**
 * DTO for change email endpoint
 * Omits callbackURL as it's set server-side
 */
export class ChangeEmailDto extends createZodDto(
  changeEmailSchema.omit({ callbackURL: true })
) {}
