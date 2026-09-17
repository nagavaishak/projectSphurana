import { Module } from '@nestjs/common';
import { TimeOffController } from './time-off.controller.js';

@Module({
  controllers: [TimeOffController],
  providers: [],
  exports: [],
})
export class TimeOffModule {}
