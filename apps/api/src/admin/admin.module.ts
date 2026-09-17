import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import {
  bullBoardAuthMiddleware,
  createBullBoardAdapter,
} from './bull-board.middleware.js';

/**
 * Admin Module
 *
 * Provides admin-only routes including:
 * - Bull Board queue monitoring dashboard at /admin/queues
 *
 * All routes require admin/owner role in the user's active organization.
 */
@Module({})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Create Bull Board adapter
    const serverAdapter = createBullBoardAdapter();

    // Apply auth middleware and Bull Board routes
    consumer
      .apply(bullBoardAuthMiddleware, serverAdapter.getRouter())
      .forRoutes('/admin/queues');
  }
}
