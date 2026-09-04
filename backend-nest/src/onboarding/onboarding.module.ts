import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { OnboardingDraftService } from './onboarding-draft.service';
import { OnboardingValidationService } from './onboarding-validation.service';
import { StarterProgramRecommendationService } from './starter-program-recommendation.service';
import { OnboardingAnalyticsService } from './onboarding-analytics.service';
import { OnboardingOutboxPublisher } from './outbox.publisher';

@Module({
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingDraftService, OnboardingValidationService, StarterProgramRecommendationService, OnboardingAnalyticsService, OnboardingOutboxPublisher],
})
export class OnboardingModule {}
