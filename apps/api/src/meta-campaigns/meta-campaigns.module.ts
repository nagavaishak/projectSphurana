import { Module } from '@nestjs/common';
import { MetaCampaignsController } from './meta-campaigns.controller';

@Module({
  controllers: [MetaCampaignsController],
})
export class MetaCampaignsModule {}
