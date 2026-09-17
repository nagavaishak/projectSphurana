import { closeMonthlyBatchQueue } from '@borradh-workspace/features/content-batches';
import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { ContentBatchesController } from './content-batches.controller.js';

@Module({
  controllers: [ContentBatchesController],
  providers: [],
  exports: [],
})
export class ContentBatchesModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await closeMonthlyBatchQueue();
  }
}
