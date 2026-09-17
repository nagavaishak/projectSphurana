import { Module } from '@nestjs/common';
import { TerminalController } from './terminal.controller.js';

@Module({
  controllers: [TerminalController],
  providers: [],
  exports: [],
})
export class TerminalModule {}
