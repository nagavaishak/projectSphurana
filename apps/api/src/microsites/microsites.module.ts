import { Module } from '@nestjs/common';
import { MicrositeDomainsController } from './domains.controller.js';
import { MicrositesController } from './microsites.controller.js';
import { PublicMicrositesController } from './public-microsites.controller.js';

@Module({
  controllers: [
    PublicMicrositesController,
    MicrositesController,
    MicrositeDomainsController,
  ],
})
export class MicrositesModule {}
