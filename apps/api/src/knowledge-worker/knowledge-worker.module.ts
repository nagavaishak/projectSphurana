import { closeKnowledgeUpdateQueue } from '@borradh-workspace/features/assistant';
import {
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Worker } from 'bullmq';
import { createKnowledgeUpdateWorker } from './knowledge-update.worker';

@Module({})
export class KnowledgeWorkerModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeWorkerModule.name);
  private worker: Worker | null = null;

  async onModuleInit() {
    this.worker = createKnowledgeUpdateWorker();
    this.logger.log('Knowledge update worker ready');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await closeKnowledgeUpdateQueue();
    this.logger.log('Knowledge update worker stopped');
  }
}
