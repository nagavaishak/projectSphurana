import { listNotificationsSchema } from '@borradh-workspace/features/notifications';
import { createZodDto } from 'nestjs-zod';

export class ListNotificationsDto extends createZodDto(
  listNotificationsSchema.omit({ userId: true })
) {}
