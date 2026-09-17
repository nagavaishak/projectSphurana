import { registerPushTokenSchema } from '@borradh-workspace/features/notifications';
import { createZodDto } from 'nestjs-zod';

export class RegisterPushTokenDto extends createZodDto(
  registerPushTokenSchema.omit({ userId: true })
) {}
