import { apiEnv } from '@borradh-workspace/env/api';
import {
  closeClaireWhatsappOutboundQueue,
  closeClaireWhatsappTurnQueue,
} from '@borradh-workspace/features/assistant';
import { closeChatbotFlowQueues } from '@borradh-workspace/features/chatbots';
import {
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Worker } from 'bullmq';
import { createChatbotFlowWorker } from './chatbot-flow.worker';
import { createClaireWhatsappOutboundWorker } from './claire-whatsapp-outbound.worker';
import { createClaireWhatsappWorker } from './claire-whatsapp.worker';

@Module({})
export class ChatbotWorkerModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatbotWorkerModule.name);
  private worker: Worker | null = null;
  private claireWhatsappWorker: Worker | null = null;
  private claireWhatsappOutboundWorker: Worker | null = null;

  async onModuleInit() {
    this.worker = createChatbotFlowWorker();
    this.logger.log('Chatbot flow worker ready');

    // Claire-on-WhatsApp workers (WS-10). Only started when the flag is on, so
    // the flag-off path never opens the queues or reads the Claire WABA
    // secrets.
    if (apiEnv.CLAIRE_WHATSAPP_ENABLED) {
      this.claireWhatsappWorker = createClaireWhatsappWorker();
      this.logger.log('Claire WhatsApp turn worker ready');

      // Proactive/async outbound deliveries (finished renders, etc.).
      this.claireWhatsappOutboundWorker = createClaireWhatsappOutboundWorker();
      this.logger.log('Claire WhatsApp outbound worker ready');
    }
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.claireWhatsappWorker) {
      await this.claireWhatsappWorker.close();
      this.claireWhatsappWorker = null;
      await closeClaireWhatsappTurnQueue();
    }
    if (this.claireWhatsappOutboundWorker) {
      await this.claireWhatsappOutboundWorker.close();
      this.claireWhatsappOutboundWorker = null;
      await closeClaireWhatsappOutboundQueue();
    }
    await closeChatbotFlowQueues();
    this.logger.log('Chatbot flow worker stopped');
  }
}
