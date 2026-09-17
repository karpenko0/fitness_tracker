import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { OnboardingDraftService } from './onboarding-draft.service';
import { OnboardingValidationService } from './onboarding-validation.service';
import { OnboardingAnalyticsService } from './onboarding-analytics.service';
import { OnboardingOutboxPublisher } from './outbox.publisher';
import { DashboardModule } from '../dashboard/dashboard.module';
import { ProgressionModule } from '../progression/progression.module';
import { ProgramModule } from '../program/program.module';

@Module({
  imports: [DashboardModule, ProgressionModule, ProgramModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingDraftService, OnboardingValidationService, OnboardingAnalyticsService, OnboardingOutboxPublisher],
})
export class OnboardingModule {}
