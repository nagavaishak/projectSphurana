import { Module } from '@nestjs/common';
import { WebsiteAnalysisController } from './website-analysis.controller.js';

@Module({
  controllers: [WebsiteAnalysisController],
  providers: [],
  exports: [],
})
export class WebsiteAnalysisModule {}
