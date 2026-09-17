import { Module } from '@nestjs/common';
import { PackagesController } from './packages.controller.js';

@Module({
  controllers: [PackagesController],
  providers: [],
  exports: [],
})
export class PackagesModule {}
