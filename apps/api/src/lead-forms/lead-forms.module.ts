import { Module } from '@nestjs/common';
import { LeadFormsController } from './lead-forms.controller.js';

@Module({
  controllers: [LeadFormsController],
  providers: [],
  exports: [],
})
export class LeadFormsModule {}
