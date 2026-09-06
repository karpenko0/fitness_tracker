import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardAggregationService } from './dashboard-aggregation.service';
import { DashboardSnapshotService } from './dashboard-snapshot.service';
import { DashboardTimezoneService } from './timezone.service';
import { DashboardPriorityService } from './dashboard-priority.service';
import { DashboardMetricsService } from './dashboard-metrics.service';
import { DashboardAuditService } from './dashboard-audit.service';
import { DashboardInvalidationService } from './dashboard-invalidation.service';
import { UserDailyStateService } from './user-daily-state.service';
import { DashboardSnapshotWorker } from './dashboard-snapshot.worker';

@Module({ controllers: [DashboardController], providers: [DashboardService, DashboardAggregationService, DashboardSnapshotService, DashboardTimezoneService, DashboardPriorityService, DashboardMetricsService, DashboardAuditService, DashboardInvalidationService, UserDailyStateService, DashboardSnapshotWorker], exports: [DashboardInvalidationService] })
export class DashboardModule {}
