import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, UserStatus } from '@prisma/client';
import { DashboardAggregationService } from './dashboard-aggregation.service';
import { DashboardSnapshotService } from './dashboard-snapshot.service';
import { DashboardTimezoneService } from './timezone.service';
import { DashboardMetricsService } from './dashboard-metrics.service';
import { ForceRefreshLimitService } from './force-refresh-limit.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger('dashboard');
  constructor(private readonly prisma: PrismaClient, private readonly aggregation: DashboardAggregationService, private readonly snapshots: DashboardSnapshotService, private readonly timezone: DashboardTimezoneService, private readonly metrics: DashboardMetricsService, private readonly config: ConfigService, private readonly forceRefreshLimit: ForceRefreshLimitService) {}
  async get(userId: string, timezoneHeader: string | undefined, localeHeader: string | undefined, forceRefresh: boolean, requestId: string) {
    const started = Date.now();
    if (forceRefresh) await this.forceRefreshLimit.check(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User was not found' });
    if (user.status === UserStatus.DELETED || user.status === UserStatus.PENDING_DELETION) throw new ForbiddenException({ code: 'ACCOUNT_DELETED', message: 'Account is deleted' });
    if (user.status === UserStatus.BLOCKED) throw new ForbiddenException({ code: 'ACCOUNT_BLOCKED', message: 'Account is blocked' });
    const resolved = this.timezone.resolve(timezoneHeader, user.profile?.timezone);
    const locale = (localeHeader || user.profile?.locale || 'ru').split(',')[0].trim().slice(0, 8) || 'ru';
    const localDate = this.timezone.localDate(new Date(), resolved.timezone);
    this.metrics.event('dashboard.requested', { requestId, userId, timezone: resolved.timezone, timezoneSource: resolved.source });
    const snapshot = await this.snapshots.get(userId, localDate, resolved.timezone, locale, forceRefresh);
    if (snapshot) {
      const data = this.withSnapshotMetadata(snapshot.snapshotData, snapshot.version, true, snapshot.expiresAt);
      this.metrics.event('dashboard.snapshot.hit', { requestId, userId });
      return data;
    }
    if (forceRefresh) this.metrics.event('dashboard.force_refresh_requested', { requestId, userId });
    const data = await this.aggregation.aggregate(userId, resolved.timezone, locale);
    if (!data) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User was not found' });
    const saved = await this.snapshots.save(userId, localDate, resolved.timezone, locale, data);
    const response = this.withSnapshotMetadata(data, saved.version, false, saved.expiresAt);
    this.metrics.event('dashboard.generated', { requestId, userId, primaryActionType: data.primaryAction.type, cacheHit: false, durationMs: Date.now() - started });
    return response;
  }

  async getForAdmin(actorUserId: string, targetUserId: string, timezoneHeader: string | undefined, localeHeader: string | undefined, requestId: string, reason: string, ipHash?: string) {
    await this.prisma.auditLog.create({ data: { actorUserId, targetUserId, action: 'ADMIN_DASHBOARD_VIEW', entityType: 'USER_DASHBOARD', entityId: targetUserId, requestId, ipHash, metadata: { reason } } });
    return this.get(targetUserId, timezoneHeader, localeHeader, false, requestId);
  }

  private withSnapshotMetadata(snapshotData: unknown, version: number, hit: boolean, expiresAt: Date) {
    const data = structuredClone(snapshotData) as { meta?: Record<string, unknown> };
    data.meta = {
      ...data.meta,
      snapshotVersion: version,
      cache: { hit, expiresAt: expiresAt.toISOString() },
    };
    return data;
  }
}
