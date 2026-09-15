import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { hostname } from 'os';
import { randomUUID } from 'crypto';
import { DashboardInvalidationService } from '../dashboard/dashboard-invalidation.service';
import { ProgressionEventHandler } from '../progression/progression-event.handler';
import { ProgressionMetricsService } from '../progression/progression-metrics.service';

const LOCK_TTL_MS = 30_000;
const MAX_ATTEMPTS = 8;

@Injectable()
export class OnboardingOutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('onboarding-outbox');
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaClient, private readonly dashboardInvalidation: DashboardInvalidationService, private readonly progressionEvents: ProgressionEventHandler, private readonly metrics: ProgressionMetricsService) {}
  onModuleInit() { this.timer = setInterval(() => void this.publish(), 5_000); }
  async publish() {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - LOCK_TTL_MS);
    const candidates = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null, deadLetteredAt: null, AND: [{ OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }] }, { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }] },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    for (const event of candidates) {
      const claimed = await this.prisma.outboxEvent.updateMany({ where: { id: event.id, publishedAt: null, deadLetteredAt: null, OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }] }, data: { lockedAt: now, lockedBy: this.workerId } });
      if (claimed.count !== 1) continue;
      try {
        if (event.type === 'workout.completed') {
          const payload = event.payload as { workoutId?: string };
          if (!payload.workoutId) throw new Error('workout.completed event has no workoutId');
          await this.progressionEvents.handleWorkoutCompleted({ workoutId: payload.workoutId });
        }
        if (event.userId && this.invalidatesDashboard(event.type)) await this.dashboardInvalidation.invalidateUser(event.userId, event.type);
        this.logger.log(JSON.stringify({ event: 'outbox.published', eventId: event.id, type: event.type }));
        await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null } });
      } catch (error) {
        const attempts = event.attempts + 1;
        const message = error instanceof Error ? error.message.slice(0, 500) : 'unknown error';
        const deadLettered = attempts >= MAX_ATTEMPTS;
        await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { attempts, lockedAt: null, lockedBy: null, lastError: message, nextAttemptAt: deadLettered ? null : new Date(Date.now() + Math.min(300_000, 2 ** attempts * 1_000)), deadLetteredAt: deadLettered ? new Date() : null } });
        this.metrics.increment('progression_outbox_retry_total', { type: event.type, status: deadLettered ? 'dead_letter' : 'retry' });
        this.logger.error(`Failed to publish outbox event ${event.id}`, error);
      }
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private invalidatesDashboard(type: string) {
    return type.startsWith('onboarding.') || type.startsWith('profile.') || type.startsWith('program.') || type.startsWith('workout.') || type.startsWith('notification.') || type.startsWith('progression.');
  }
}
