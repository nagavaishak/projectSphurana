import { Module } from '@nestjs/common';
import { PractitionersController } from './practitioners.controller.js';

@Module({
  controllers: [PractitionersController],
})
export class PractitionersModule {}
