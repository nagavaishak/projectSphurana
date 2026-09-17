import { Module } from '@nestjs/common';
import { DocumentImportsController } from './document-imports.controller.js';

@Module({
  controllers: [DocumentImportsController],
})
export class DocumentImportsModule {}
