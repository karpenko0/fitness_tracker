import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { PrismaModule } from './prisma.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { WorkoutModule } from './workout/workout.module';
import { ProgramModule } from './program/program.module';
import { ProgressionModule } from './progression/progression.module';
import { MeasurementModule } from './measurement/measurement.module';
import { ProgressPhotoModule } from './progress-photo/progress-photo.module';
import { ProgressChartModule } from './progress-chart/progress-chart.module';
import { ProgressComparisonModule } from './progress-comparison/progress-comparison.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { ProgressionApiMetricsInterceptor } from './progression/progression-audit.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    PrismaModule,
    AuthModule,
    UserModule,
    OnboardingModule,
    DashboardModule,
    WorkoutModule,
    ProgramModule,
    ProgressionModule,
    MeasurementModule,
    ProgressPhotoModule,
    ProgressChartModule,
    ProgressComparisonModule,
    SubscriptionModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_INTERCEPTOR, useClass: ProgressionApiMetricsInterceptor }],
})
export class AppModule {}