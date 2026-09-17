import { Module } from '@nestjs/common';
import { VoiceScriptsController } from './voice-scripts.controller.js';

@Module({
  controllers: [VoiceScriptsController],
  providers: [],
  exports: [],
})
export class VoiceScriptsModule {}
