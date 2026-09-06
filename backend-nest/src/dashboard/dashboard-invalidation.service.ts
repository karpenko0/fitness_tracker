import { Injectable } from '@nestjs/common';
import { DashboardSnapshotService } from './dashboard-snapshot.service';
import { DashboardMetricsService } from './dashboard-metrics.service';

@Injectable()
export class DashboardInvalidationService {
  constructor(private readonly snapshots: DashboardSnapshotService, private readonly metrics: DashboardMetricsService) {}
  async invalidateUser(userId: string, reason: string) {
    const result = await this.snapshots.invalidate(userId, reason);
    this.metrics.event('dashboard.snapshot.invalidated', { userId, reason, count: result.count });
    return result;
  }
}
