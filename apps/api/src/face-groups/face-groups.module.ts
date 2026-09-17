import { Module } from '@nestjs/common';
import { FaceGroupsController } from './face-groups.controller.js';

@Module({
  controllers: [FaceGroupsController],
  providers: [],
  exports: [],
})
export class FaceGroupsModule {}
