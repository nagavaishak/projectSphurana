import { Module } from '@nestjs/common';
import { WageConfigsController } from './wage-configs.controller.js';

@Module({
  controllers: [WageConfigsController],
  providers: [],
  exports: [],
})
export class WageConfigsModule {}
