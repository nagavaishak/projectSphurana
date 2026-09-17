import { Module } from '@nestjs/common';
import { LeadMembershipsController } from './lead-memberships.controller.js';
import { MembershipPlansController } from './membership-plans.controller.js';

@Module({
  controllers: [MembershipPlansController, LeadMembershipsController],
  providers: [],
  exports: [],
})
export class MembershipsModule {}
