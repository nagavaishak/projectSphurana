import { Module } from '@nestjs/common';
import { TrainingHubController } from './training-hub.controller';

@Module({
  controllers: [TrainingHubController],
})
export class TrainingHubModule {}
