import { Module } from '@nestjs/common';
import { IntakeFormsController } from './intake-forms.controller.js';
import { PublicIntakeController } from './public-intake.controller.js';

@Module({
  controllers: [IntakeFormsController, PublicIntakeController],
  providers: [],
  exports: [],
})
export class IntakeFormsModule {}
