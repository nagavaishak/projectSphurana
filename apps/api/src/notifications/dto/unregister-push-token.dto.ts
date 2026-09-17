import { unregisterPushTokenSchema } from '@borradh-workspace/features/notifications';
import { createZodDto } from 'nestjs-zod';

export class UnregisterPushTokenDto extends createZodDto(
  unregisterPushTokenSchema
) {}
