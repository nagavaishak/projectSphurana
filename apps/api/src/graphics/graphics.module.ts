import { Module } from '@nestjs/common';
import { GraphicsController } from './graphics.controller.js';

@Module({
  controllers: [GraphicsController],
  providers: [],
  exports: [],
})
export class GraphicsModule {}
