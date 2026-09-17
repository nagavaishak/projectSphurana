import { Module } from '@nestjs/common';
import { ClaireRecommendationsController } from './claire-recommendations.controller.js';

@Module({
  controllers: [ClaireRecommendationsController],
})
export class ClaireRecommendationsModule {}
