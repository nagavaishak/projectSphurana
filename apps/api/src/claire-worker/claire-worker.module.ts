import { closeClaireClassifyQueue } from '@borradh-workspace/features/claire';
import {
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Worker } from 'bullmq';
import { createClaireClassifyWorker } from './claire-classify.worker';

@Module({})
export class ClaireWorkerModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClaireWorkerModule.name);
  private worker: Worker | null = null;

  async onModuleInit() {
    this.worker = createClaireClassifyWorker();
    this.logger.log('Claire classify worker ready');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await closeClaireClassifyQueue();
    this.logger.log('Claire classify worker stopped');
  }
}
