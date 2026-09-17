import { Module } from '@nestjs/common';
import { AssistantChatController } from './assistant-chat.controller.js';
import { AssistantController } from './assistant.controller.js';
import { MemoriesController } from './memories.controller.js';
import { UploadsController } from './uploads.controller.js';
import { WhatsappLinkController } from './whatsapp-link.controller.js';

@Module({
  controllers: [
    AssistantController,
    AssistantChatController,
    UploadsController,
    MemoriesController,
    WhatsappLinkController,
  ],
})
export class AssistantModule {}
