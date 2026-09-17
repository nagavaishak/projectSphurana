import { Module } from '@nestjs/common';
import { ResourcesController } from './resources.controller.js';

@Module({
  controllers: [ResourcesController],
  providers: [],
  exports: [],
})
export class ResourcesModule {}
