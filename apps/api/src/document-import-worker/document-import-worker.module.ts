import { warmupDocumentRasterizer } from '@borradh-workspace/features/document-imports';
import {
  closeJobQueue,
  documentMatchQueue,
} from '@borradh-workspace/features/jobs';
import {
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Worker } from 'bullmq';
import { createDocumentMatchWorker } from './document-match.worker';

@Module({})
export class DocumentImportWorkerModule
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DocumentImportWorkerModule.name);
  private worker: Worker | null = null;

  async onModuleInit() {
    // Load pdfjs + canvas + sharp NOW, not on the first job. The Docker
    // smoke test only catches a missing native binding when it is required
    // during boot — a lazily-imported rasterizer would slip through and fail
    // on the first real import in production.
    await warmupDocumentRasterizer();
    this.worker = createDocumentMatchWorker();
    this.logger.log('Document match worker ready');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await closeJobQueue(documentMatchQueue);
    this.logger.log('Document match worker stopped');
  }
}
