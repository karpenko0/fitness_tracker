import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ACCESS_STATUSES, PRODUCT_SCOPE } from './subscription.catalog';
import { EntitlementsService } from './entitlements.service';
import { SubscriptionLogger, SubscriptionMetrics } from './subscription.observability';
import { Db, PRISMA } from './subscription.prisma';
import { writeAudit, writeOutbox } from './subscription.support';
import { TelegramWebhookService } from './telegram-webhook.service';

const HOUR = 3_600_000;

/** Фоновые задачи: истечение (≥ 1/час), recovery webhook, reconciliation PAID без прав. */
@Injectable()
export class SubscriptionScheduler implements OnModuleInit, OnModuleDestroy {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(PRISMA) private readonly prisma: Db,
    private readonly config: ConfigService,
    private readonly entitlements: EntitlementsService,
    private readonly webhooks: TelegramWebhookService,
    private readonly metrics: SubscriptionMetrics,
    private readonly logger: SubscriptionLogger,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || this.config.get('SUBSCRIPTION_JOBS_ENABLED') === 'false') return;
    const safe = (name: string, fn: () => Promise<unknown>) => () => fn().catch(e => this.logger.log(`job.${name}.failed`, { errorCode: e?.code ?? 'JOB_ERROR' }, 'error'));
    // Recovery сразу после старта: подхватить RECEIVED/FAILED события.
    setTimeout(safe('recovery', () => this.webhooks.recoverPending()), 10_000).unref?.();
    this.timers.push(setInterval(safe('expire', () => this.expireDue()), 15 * 60_000));
    this.timers.push(setInterval(safe('recovery', () => this.webhooks.recoverPending()), 60_000));
    this.timers.push(setInterval(safe('reconcile', () => this.reconcile()), 5 * 60_000));
    this.timers.forEach(t => t.unref?.());
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }

  /** ACTIVE/EXPIRING с current_period_end <= now → EXPIRED; идемпотентно при повторном запуске. */
  async expireDue(now = new Date(), batch = 500) {
    const due = await this.prisma.subscription.findMany({
      where: { productScope: PRODUCT_SCOPE, status: { in: ACCESS_STATUSES }, currentPeriodEnd: { lte: now } },
      take: batch,
      orderBy: { currentPeriodEnd: 'asc' },
    });
    let expired = 0;
    for (const sub of due) {
      const done = await this.prisma.$transaction(async (tx: Db) => {
        const upd = await tx.subscription.updateMany({
          where: { id: sub.id, version: sub.version, status: { in: ACCESS_STATUSES }, currentPeriodEnd: { lte: now } },
          data: { status: 'EXPIRED', expiredAt: now, autoRenew: false, version: { increment: 1 } },
        });
        if (upd.count !== 1) return false; // продлено/изменено параллельно
        await this.entitlements.recompute(tx, sub.userId, now);
        await writeAudit(tx, { targetUserId: sub.userId, action: 'subscription.expired', entityType: 'subscription', entityId: sub.id, before: { status: sub.status }, after: { status: 'EXPIRED' } });
        await writeOutbox(tx, 'subscription.expired', sub.userId, { subscriptionId: sub.id, tier: sub.tier });
        return true;
      });
      if (done) {
        expired++;
        this.metrics.inc('subscription_expired_total', { tier: sub.tier });
        this.logger.log('subscription.expired', { userId: sub.userId, subscriptionId: sub.id });
      }
    }
    return { scanned: due.length, expired };
  }

  /** Алерт: PAID payment без активных entitlements дольше 5 минут. */
  async reconcile(now = new Date()) {
    const since = new Date(now.getTime() - 24 * HOUR);
    const until = new Date(now.getTime() - 5 * 60_000);
    const paid = await this.prisma.payment.findMany({
      where: { status: 'PAID', requiresManualReview: false, paidAt: { gte: since, lte: until }, subscriptionId: { not: null } },
      include: { subscription: true },
      take: 500,
    });
    const mismatched: string[] = [];
    for (const p of paid) {
      const sub = p.subscription;
      if (!sub || !ACCESS_STATUSES.includes(sub.status) || sub.currentPeriodEnd <= now) continue;
      const count = await this.prisma.userEntitlement.count({ where: { userId: p.userId, expiresAt: { gt: now } } });
      if (count === 0) {
        mismatched.push(p.id);
        await this.prisma.$transaction((tx: Db) => this.entitlements.recompute(tx, p.userId, now));
      }
    }
    if (mismatched.length) this.logger.log('payment.entitlement_mismatch', { count: mismatched.length }, 'error');
    this.metrics.set('payment_entitlement_mismatch', {}, mismatched.length);
    return { mismatched };
  }
}
