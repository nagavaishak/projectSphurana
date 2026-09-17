import { closeVoiceIngestQueue } from '@borradh-workspace/features/voice-cloning';
import {
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Worker } from 'bullmq';
import { createVoiceIngestWorker } from './voice-ingest.worker';

@Module({})
export class VoiceIngestWorkerModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceIngestWorkerModule.name);
  private worker: Worker | null = null;

  async onModuleInit() {
    this.worker = createVoiceIngestWorker();
    this.logger.log('Voice ingest worker ready');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await closeVoiceIngestQueue();
    this.logger.log('Voice ingest worker stopped');
  }
}
