import { Module } from '@nestjs/common';
import { OrganizationServicesController } from './organization-services.controller.js';

@Module({
  controllers: [OrganizationServicesController],
  providers: [],
  exports: [],
})
export class OrganizationServicesModule {}
