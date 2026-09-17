import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MetricsCollectorService } from './metrics-collector.service';

@Module({
  controllers: [HealthController],
  providers: [MetricsCollectorService],
})
export class HealthModule {}
