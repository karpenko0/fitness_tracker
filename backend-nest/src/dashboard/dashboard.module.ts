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
import { AdminDashboardController } from './admin-dashboard.controller';
import { ForceRefreshLimitService } from './force-refresh-limit.service';
import { DashboardRedisService } from './redis.service';

@Module({ controllers: [DashboardController, AdminDashboardController], providers: [DashboardService, DashboardAggregationService, DashboardSnapshotService, DashboardTimezoneService, DashboardPriorityService, DashboardMetricsService, DashboardAuditService, DashboardInvalidationService, UserDailyStateService, DashboardSnapshotWorker, ForceRefreshLimitService, DashboardRedisService], exports: [DashboardInvalidationService, DashboardRedisService] })
export class DashboardModule {}
