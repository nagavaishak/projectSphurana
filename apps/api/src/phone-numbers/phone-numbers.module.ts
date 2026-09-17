import { Module } from '@nestjs/common';
import { PhoneNumbersController } from './phone-numbers.controller.js';

@Module({
  controllers: [PhoneNumbersController],
  providers: [],
  exports: [],
})
export class PhoneNumbersModule {}
