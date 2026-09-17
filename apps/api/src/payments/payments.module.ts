import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller.js';

@Module({
  controllers: [PaymentsController],
  providers: [],
  exports: [],
})
export class PaymentsModule {}
