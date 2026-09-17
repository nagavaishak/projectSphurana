import { Module } from '@nestjs/common';
import { DepositsController } from './deposits.controller.js';

@Module({
  controllers: [DepositsController],
  providers: [],
  exports: [],
})
export class DepositsModule {}
