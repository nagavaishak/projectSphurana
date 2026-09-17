import { Module } from '@nestjs/common';
import { CdnController } from './cdn.controller';

@Module({
  controllers: [CdnController],
})
export class CdnModule {}
