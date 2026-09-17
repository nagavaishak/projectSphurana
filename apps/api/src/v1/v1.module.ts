import { Module } from '@nestjs/common';
import { V1AppointmentsController } from './appointments/v1-appointments.controller';
import { V1AssetsController } from './assets/v1-assets.controller';
import { V1LeadFormsController } from './lead-forms/v1-lead-forms.controller';
import { V1LeadsController } from './leads/v1-leads.controller';
import { V1OrganizationController } from './organization/v1-organization.controller';
import { V1SocialPostsController } from './social-posts/v1-social-posts.controller';

@Module({
  controllers: [
    V1LeadsController,
    V1AppointmentsController,
    V1LeadFormsController,
    V1OrganizationController,
    V1SocialPostsController,
    V1AssetsController,
  ],
})
export class V1Module {}
