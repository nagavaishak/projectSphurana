import { Module } from '@nestjs/common';
import { OrganizationLocationsController } from './organization-locations.controller.js';

@Module({
  controllers: [OrganizationLocationsController],
  providers: [],
  exports: [],
})
export class OrganizationLocationsModule {}
