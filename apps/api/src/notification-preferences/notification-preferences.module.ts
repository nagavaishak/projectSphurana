import { Module } from '@nestjs/common';
import { NotificationPreferencesController } from './notification-preferences.controller.js';

@Module({
  controllers: [NotificationPreferencesController],
})
export class NotificationPreferencesModule {}
