import { closeJobQueues } from '@borradh-workspace/features/jobs';
import {
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Worker } from 'bullmq';
import { createLeadFirstTouchWorker } from './lead-first-touch.worker';

@Module({})
export class LeadFirstTouchWorkerModule
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LeadFirstTouchWorkerModule.name);
  private worker: Worker | null = null;

  async onModuleInit() {
    this.worker = createLeadFirstTouchWorker();
    this.logger.log('Lead first-touch worker ready');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await closeJobQueues();
    this.logger.log('Lead first-touch worker stopped');
  }
}
