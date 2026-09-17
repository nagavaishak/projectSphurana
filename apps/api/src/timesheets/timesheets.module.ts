import { Module } from '@nestjs/common';
import { TimesheetsController } from './timesheets.controller.js';

@Module({
  controllers: [TimesheetsController],
  providers: [],
  exports: [],
})
export class TimesheetsModule {}
