import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ClaireTriggersSchedulerService } from './claire-triggers.scheduler.service';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [SchedulerService, ClaireTriggersSchedulerService],
})
export class SchedulerModule {}
