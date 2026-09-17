import { Module } from '@nestjs/common';
import { BlockedTimeTypesController } from './blocked-time-types.controller.js';
import { BlockedTimeController } from './blocked-time.controller.js';

@Module({
  controllers: [BlockedTimeTypesController, BlockedTimeController],
  providers: [],
  exports: [],
})
export class BlockedTimeModule {}
