import { Module } from '@nestjs/common';

import { AppVersionController } from './app-version.controller.js';

@Module({
  controllers: [AppVersionController],
})
export class AppVersionModule {}
