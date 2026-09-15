import { Module } from '@nestjs/common';
import { LoadRecommendationService } from './load-recommendation.service';
import { OneRmCalculationService } from './one-rm-calculation.service';
import { PersonalRecordService } from './personal-record.service';
import { ProgressionController } from './progression.controller';
import { ProgressionMetricsService } from './progression-metrics.service';
import { ProgressionService } from './progression.service';
import { ProgressionEventHandler } from './progression-event.handler';
import { VolumeCalculationService } from './volume-calculation.service';
import { ProgressionApiMetricsInterceptor, ProgressionAuditService } from './progression-audit.service';
import { ProgressionHistoryService } from './progression-history.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { ProgressionCacheService } from './progression-cache.service';
import { AdminProgressionController } from './admin-progression.controller';
import { ProgressionConfigController } from './progression-config.controller';
import { ProgressionConfigService } from './progression-config.service';
import { ProgressionMetricsController } from './metrics.controller';

@Module({
  imports: [DashboardModule],
  controllers: [ProgressionController, AdminProgressionController, ProgressionConfigController, ProgressionMetricsController],
  providers: [ProgressionService, VolumeCalculationService, OneRmCalculationService, PersonalRecordService, LoadRecommendationService, ProgressionMetricsService, ProgressionEventHandler, ProgressionAuditService, ProgressionHistoryService, ProgressionCacheService, ProgressionConfigService, ProgressionApiMetricsInterceptor],
  exports: [ProgressionService, ProgressionEventHandler, ProgressionMetricsService],
})
export class ProgressionModule {}
