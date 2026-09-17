import { closeAppointmentQueue } from '@borradh-workspace/features/appointments';
import {
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Worker } from 'bullmq';
import { createBookingWorker } from './booking.worker';

/**
 * Hosts the in-process BullMQ worker for the `appointment-lifecycle` queue
 * (reminders, deposit expiry, calendar sync). Registered in AppModule alongside
 * the other in-process workers — no separate deploy process.
 */
@Module({})
export class BookingWorkerModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingWorkerModule.name);
  private worker: Worker | null = null;

  onModuleInit() {
    this.worker = createBookingWorker();
    this.logger.log('Booking lifecycle worker ready');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await closeAppointmentQueue();
    this.logger.log('Booking lifecycle worker stopped');
  }
}
