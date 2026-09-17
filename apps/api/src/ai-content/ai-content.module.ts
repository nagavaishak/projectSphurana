import { Module } from '@nestjs/common';
import { AiContentController } from './ai-content.controller.js';

@Module({
  controllers: [AiContentController],
})
export class AiContentModule {}
