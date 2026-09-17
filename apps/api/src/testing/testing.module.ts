import { Module } from '@nestjs/common';
import {
  DestructiveTestingGuard,
  SeedTokenGuard,
} from './guards/seed-token.guard.js';
import { TestingController } from './testing.controller';
import { TestingService } from './testing.service';

/**
 * Testing module for E2E test data seeding and cleanup.
 * Only enabled in staging environments (not production).
 */
@Module({
  controllers: [TestingController],
  providers: [TestingService, SeedTokenGuard, DestructiveTestingGuard],
})
export class TestingModule {}
