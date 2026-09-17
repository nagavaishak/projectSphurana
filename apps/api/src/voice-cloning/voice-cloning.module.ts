import { Module } from '@nestjs/common';
import { VoiceCloningController } from './voice-cloning.controller.js';

@Module({
  controllers: [VoiceCloningController],
})
export class VoiceCloningModule {}
