import { Module } from '@nestjs/common';
import { ChatbotsController } from './chatbots.controller';

@Module({
  controllers: [ChatbotsController],
})
export class ChatbotsModule {}
