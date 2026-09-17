import { Module } from '@nestjs/common';
import { AdminTerminalController } from './admin-terminal.controller.js';

@Module({
  controllers: [AdminTerminalController],
})
export class AdminTerminalModule {}
