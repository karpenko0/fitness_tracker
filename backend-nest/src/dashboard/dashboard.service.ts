import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, UserStatus } from '@prisma/client';
import { DashboardAggregationService } from './dashboard-aggregation.service';
import { DashboardSnapshotService } from './dashboard-snapshot.service';
import { DashboardTimezoneService } from './timezone.service';
import { DashboardMetricsService } from './dashboard-metrics.service';
import { UserDailyStateService } from './user-daily-state.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger('dashboard');
  constructor(private readonly prisma: PrismaClient, private readonly aggregation: DashboardAggregationService, private readonly snapshots: DashboardSnapshotService, private readonly timezone: DashboardTimezoneService, private readonly metrics: DashboardMetricsService, private readonly dailyState: UserDailyStateService, private readonly config: ConfigService) {}
  async get(userId: string, timezoneHeader: string | undefined, localeHeader: string | undefined, forceRefresh: boolean, requestId: string) {
    const started = Date.now();
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
      const data = snapshot.snapshotData as any;
      data.meta.cache = { hit: true, expiresAt: snapshot.expiresAt.toISOString() };
      this.metrics.event('dashboard.snapshot.hit', { requestId, userId });
      return data;
    }
    if (forceRefresh) this.metrics.event('dashboard.force_refresh_requested', { requestId, userId });
    const data = await this.aggregation.aggregate(userId, resolved.timezone, locale);
    if (!data) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User was not found' });
    const saved = await this.snapshots.save(userId, localDate, resolved.timezone, locale, data);
    data.meta.snapshotVersion = saved.version;
    data.meta.cache.expiresAt = saved.expiresAt.toISOString();
    await this.dailyState.save(userId, localDate, resolved.timezone, data.today.state as any, data.primaryAction.type as any, { activeWorkoutId: data.primaryAction.type === 'RESUME_WORKOUT' ? data.primaryAction.workoutId ?? undefined : undefined, plannedWorkoutId: data.primaryAction.type === 'START_WORKOUT' ? data.primaryAction.workoutId ?? undefined : undefined, activeProgramId: data.activeProgram?.id }, { completed: data.today.completedWorkoutCount, planned: data.today.plannedWorkoutCount });
    this.metrics.event('dashboard.generated', { requestId, userId, primaryActionType: data.primaryAction.type, cacheHit: false, durationMs: Date.now() - started });
    return data;
  }
}
