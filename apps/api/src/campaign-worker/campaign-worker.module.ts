import { createLogger } from '@borradh-workspace/observability';
import {
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Worker } from 'bullmq';
import { createCampaignSendWorker } from './campaign-send.worker.js';

const logger = createLogger('CampaignWorkerModule');

/**
 * Starts the campaign-send BullMQ worker with the API process (mirrors the
 * chatbot/voice/knowledge workers). Co-hosting is the cheapest correct option
 * at current scale; splitting into a dedicated task is a deploy change only.
 */
@Module({})
export class CampaignWorkerModule implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker;

  onModuleInit() {
    this.worker = createCampaignSendWorker();
    logger.info('CampaignWorkerModule initialized');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      logger.info('Campaign send worker closed');
    }
  }
}
