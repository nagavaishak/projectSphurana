import { Module } from '@nestjs/common';
import {
  ClaireAdCreationContextController,
  ClaireAdminController,
} from './claire-ad-creation-context.controller.js';

@Module({
  controllers: [ClaireAdCreationContextController, ClaireAdminController],
})
export class ClaireAdCreationContextModule {}
