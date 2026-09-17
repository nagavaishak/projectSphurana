import { Module } from '@nestjs/common';
import { OrgDefaultsController } from './org-defaults.controller.js';

@Module({
  controllers: [OrgDefaultsController],
})
export class OrgDefaultsModule {}
