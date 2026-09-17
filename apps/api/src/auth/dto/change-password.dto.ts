import { changePasswordSchema } from '@borradh-workspace/features/auth';
import { createZodDto } from 'nestjs-zod';

/**
 * DTO for change password endpoint
 * Omits revokeOtherSessions as it's set server-side
 */
export class ChangePasswordDto extends createZodDto(
  changePasswordSchema.omit({ revokeOtherSessions: true })
) {}
