import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller.js';

@Module({
  controllers: [OnboardingController],
  providers: [],
  exports: [],
})
export class OnboardingModule {}
