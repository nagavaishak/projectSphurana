import { updateNotificationPreferencesSchema } from '@borradh-workspace/features/notification-preferences';
import { createZodDto } from 'nestjs-zod';

export class UpdateNotificationPreferencesDto extends createZodDto(
  updateNotificationPreferencesSchema.omit({ userId: true })
) {}
