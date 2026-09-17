import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller.js';

@Module({
  controllers: [ShiftsController],
  providers: [],
  exports: [],
})
export class ShiftsModule {}
