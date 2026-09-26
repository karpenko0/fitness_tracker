import { Inject, Injectable } from '@nestjs/common';
import { ACCESS_STATUSES, INVOICE_TTL_MINUTES, PRODUCT_SCOPE, STARS_CURRENCY } from './subscription.catalog';
import {
  assertCanPurchase, assertIdempotencyKey, decodeCursor, effectiveTier, encodeCursor, generateInvoicePayload, hasAccess, isValidPlanCode,
  isValidStarsAmount, planVisibleForRoles, sha256, SubscriptionError,
} from './subscription.domain';
import { EntitlementsService } from './entitlements.service';
import { SubscriptionLogger, SubscriptionMetrics } from './subscription.observability';
import { Db, OptimisticLockError, PRISMA } from './subscription.prisma';
import { FinancialIdempotency, writeAudit, writeOutbox } from './subscription.support';
import { TELEGRAM_SUBSCRIPTION_PERIOD_SECONDS, TelegramBotClient } from './telegram-bot.client';

export interface Actor {
  userId: string;
  requestId: string;
}

export function serializeSubscription(sub: any | null) {
  if (!sub) return null;
  return {
    id: sub.id,
    planCode: sub.plan?.code ?? null,
    tier: sub.tier,
    status: sub.status,
    autoRenew: sub.autoRenew,
    currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    cancelledAt: sub.cancelledAt?.toISOString() ?? null,
  };
}

export function serializePayment(p: any) {
  return {
    id: p.id,
    planCode: p.plan?.code ?? p.planSnapshot?.code ?? null,
    amountStars: p.amountStars,
    currency: p.currency,
    status: p.status,
    paidAt: p.paidAt?.toISOString() ?? null,
    refundedAt: p.refundedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Db,
    private readonly entitlements: EntitlementsService,
    private readonly idempotency: FinancialIdempotency,
    private readonly telegram: TelegramBotClient,
    private readonly metrics: SubscriptionMetrics,
    private readonly logger: SubscriptionLogger,
  ) {}

  /** Роли из БД (не из JWT): TRAINER — роль либо подтверждённый тренерский профиль. */
  async rolesOf(userId: string, db: Db = this.prisma): Promise<string[]> {
    const rows = await db.userRole.findMany({ where: { userId }, include: { role: true } });
    return rows.map((r: any) => r.role?.code).filter(Boolean);
  }

  async listPlans(actor: Actor) {
    const [roles, access, plans] = await Promise.all([
      this.rolesOf(actor.userId),
      this.entitlements.getAccess(actor.userId),
      this.prisma.billingPlan.findMany({ where: { isActive: true }, orderBy: [{ tier: 'asc' }, { periodDays: 'asc' }] }),
    ]);
    this.logger.log('subscription.plan.listed', { requestId: actor.requestId, userId: actor.userId });
    return {
      plans: plans
        .filter((p: any) => planVisibleForRoles(p.tier, roles))
        .map((p: any) => ({
          code: p.code,
          tier: p.tier,
          title: p.title,
          periodDays: p.periodDays,
          amountStars: p.amountStars,
          currency: p.currency,
          features: p.features,
          autoRenewable: p.autoRenewable,
          isCurrentPlan: access.tier !== 'FREE' && access.subscription?.planId === p.id,
        })),
    };
  }

  async getMe(actor: Actor, now = new Date()) {
    const [access, paywall] = await Promise.all([this.entitlements.getAccess(actor.userId, now), this.entitlements.paywall(actor.userId)]);
    return {
      effectiveTier: access.tier,
      entitlements: access.entitlements,
      subscription: hasAccess(access.subscription, now) ? serializeSubscription(access.subscription) : null,
      paywallEligibility: paywall,
    };
  }

  async createInvoice(actor: Actor, body: { planCode: string }, rawKey: unknown, now = new Date()) {
    const key = assertIdempotencyKey(rawKey);
    if (!isValidPlanCode(body?.planCode)) throw new SubscriptionError(400, 'VALIDATION_ERROR', 'planCode is invalid', { field: 'planCode' });
    const started = Date.now();

    const user = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { id: true, status: true, deletedAt: true } });
    if (!user || user.status !== 'ACTIVE' || user.deletedAt) throw new SubscriptionError(403, 'ACCOUNT_INACTIVE', 'Account is not active');

    const idem = await this.idempotency.begin(actor.userId, 'CREATE_INVOICE', key, { planCode: body.planCode }, now);
    if (idem.replay) return idem.replay.body;

    try {
      if (idem.resumed) {
        const existing = await this.prisma.payment.findFirst({ where: { userId: actor.userId, idempotencyKey: key, status: 'PENDING' }, include: { plan: true } });
        if (existing?.invoiceLink) {
          const response = this.invoiceResponse(existing);
          await this.idempotency.complete(idem.recordId, 201, response);
          return response;
        }
      }

      const plan = await this.prisma.billingPlan.findUnique({ where: { code: body.planCode } });
      if (!plan || !plan.isActive) throw new SubscriptionError(404, 'PLAN_NOT_FOUND', 'Plan not found');
      if (plan.currency !== STARS_CURRENCY || !isValidStarsAmount(plan.amountStars)) throw new SubscriptionError(404, 'PLAN_NOT_FOUND', 'Plan not found');

      const [roles, access] = await Promise.all([this.rolesOf(actor.userId), this.entitlements.getAccess(actor.userId, now)]);
      assertCanPurchase({ planTier: plan.tier, roles, currentAccessTier: access.tier });
      if (access.subscription && hasAccess(access.subscription, now) && access.subscription.autoRenew && access.subscription.telegramSubscriptionChargeId) {
        throw new SubscriptionError(409, 'ACTIVE_SUBSCRIPTION_CONFLICT', 'An auto-renewing subscription is already active');
      }

      const payload = generateInvoicePayload();
      const expiresAt = new Date(now.getTime() + INVOICE_TTL_MINUTES * 60_000);
      const payment = await this.prisma.$transaction(async (tx: Db) => {
        const created = await tx.payment.create({
          data: {
            userId: actor.userId,
            planId: plan.id,
            status: 'PENDING',
            amountStars: plan.amountStars,
            currency: STARS_CURRENCY,
            invoicePayloadHash: sha256(payload),
            expiresAt,
            idempotencyKey: key,
            planSnapshot: { code: plan.code, tier: plan.tier, title: plan.title, periodDays: plan.periodDays, amountStars: plan.amountStars, currency: plan.currency, version: plan.version },
          },
        });
        await writeAudit(tx, { actorUserId: actor.userId, targetUserId: actor.userId, action: 'payment.invoice.created', entityType: 'payment', entityId: created.id, requestId: actor.requestId, planCode: plan.code, amountStars: plan.amountStars });
        return created;
      });

      let invoiceLink: string;
      try {
        // Внешний вызов вне БД-транзакции.
        invoiceLink = await this.telegram.createInvoiceLink({
          title: plan.title,
          description: `${plan.title}: ${(plan.features as string[]).length} возможностей`,
          payload,
          amountStars: plan.amountStars,
          subscriptionPeriodSeconds: plan.autoRenewable && plan.periodDays === 30 ? TELEGRAM_SUBSCRIPTION_PERIOD_SECONDS : undefined,
        });
      } catch (e: any) {
        await this.prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } });
        this.metrics.inc('payment_processing_total', { status: 'FAILED', error_code: 'INVOICE_CREATE_FAILED' });
        this.logger.log('payment.invoice.failed', { requestId: actor.requestId, userId: actor.userId, paymentId: payment.id, errorCode: e?.code ?? 'TELEGRAM_ERROR' }, 'error');
        throw new SubscriptionError(502, 'TELEGRAM_UNAVAILABLE', 'Unable to create invoice, retry later');
      }
      const updated = await this.prisma.payment.update({ where: { id: payment.id }, data: { invoiceLink }, include: { plan: true } });
      const response = this.invoiceResponse(updated);
      await this.idempotency.complete(idem.recordId, 201, response);
      this.metrics.inc('subscription_invoice_created_total', { plan_code: plan.code, tier: plan.tier });
      this.logger.log('payment.invoice.created', { requestId: actor.requestId, userId: actor.userId, paymentId: payment.id, durationMs: Date.now() - started });
      return response;
    } catch (e) {
      await this.idempotency.release(idem.recordId);
      throw e;
    }
  }

  private invoiceResponse(p: any) {
    return {
      paymentId: p.id,
      planCode: p.plan?.code ?? p.planSnapshot?.code,
      amountStars: p.amountStars,
      currency: p.currency,
      status: p.status,
      invoiceLink: p.invoiceLink,
      expiresAt: p.expiresAt.toISOString(),
    };
  }

  /** Отмена автопродления: ACTIVE → EXPIRING, доступ до current_period_end. */
  async cancelAutoRenew(actor: Actor, rawKey: unknown, now = new Date()) {
    const key = assertIdempotencyKey(rawKey);
    const idem = await this.idempotency.begin(actor.userId, 'CANCEL_AUTO_RENEW', key, {}, now);
    if (idem.replay) return idem.replay.body;
    try {
      const sub = await this.entitlements.findAccessSubscription(actor.userId);
      if (!sub || !hasAccess(sub, now)) throw new SubscriptionError(404, 'ACTIVE_SUBSCRIPTION_NOT_FOUND', 'No active subscription');
      if (sub.status === 'EXPIRING') {
        const body = { subscription: serializeSubscription(sub) };
        await this.idempotency.complete(idem.recordId, 200, body);
        return body;
      }
      if (!sub.autoRenew || !sub.telegramSubscriptionChargeId) throw new SubscriptionError(409, 'CANCELLATION_NOT_SUPPORTED', 'This subscription has no auto-renewal to cancel');

      const user = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { telegramId: true } });
      try {
        await this.telegram.editUserStarSubscription(String(user.telegramId), sub.telegramSubscriptionChargeId, true);
      } catch (e: any) {
        this.logger.log('subscription.cancel.failed', { requestId: actor.requestId, userId: actor.userId, subscriptionId: sub.id, errorCode: e?.code }, 'error');
        throw new SubscriptionError(502, 'TELEGRAM_UNAVAILABLE', 'Unable to cancel auto-renewal, retry later');
      }

      const updated = await this.prisma.$transaction(async (tx: Db) => {
        const res = await tx.subscription.updateMany({
          where: { id: sub.id, version: sub.version, status: 'ACTIVE' },
          data: { status: 'EXPIRING', autoRenew: false, cancelledAt: now, version: { increment: 1 } },
        });
        if (res.count !== 1) throw new OptimisticLockError('subscription');
        await writeAudit(tx, { actorUserId: actor.userId, targetUserId: actor.userId, action: 'subscription.auto_renew.cancelled', entityType: 'subscription', entityId: sub.id, requestId: actor.requestId, before: { status: 'ACTIVE', autoRenew: true }, after: { status: 'EXPIRING', autoRenew: false } });
        await writeOutbox(tx, 'subscription.expiring', actor.userId, { subscriptionId: sub.id, currentPeriodEnd: sub.currentPeriodEnd.toISOString() });
        return tx.subscription.findUnique({ where: { id: sub.id }, include: { plan: true } });
      });
      this.logger.log('subscription.expiring', { requestId: actor.requestId, userId: actor.userId, subscriptionId: sub.id });
      const body = { subscription: serializeSubscription(updated) };
      await this.idempotency.complete(idem.recordId, 200, body);
      return body;
    } catch (e) {
      await this.idempotency.release(idem.recordId);
      if (e instanceof OptimisticLockError) throw new SubscriptionError(409, 'CONCURRENT_MODIFICATION', 'Subscription was modified concurrently, retry');
      throw e;
    }
  }

  async listPayments(userId: string, query: { cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(Number(query.limit ?? 20) || 20, 1), 100);
    const where: any = { userId };
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      where.OR = [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }];
    }
    const rows = await this.prisma.payment.findMany({ where, include: { plan: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return { items: items.map(serializePayment), nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null, hasMore };
  }

  async activeCountsByTier(now = new Date()) {
    const subs = await this.prisma.subscription.findMany({ where: { productScope: PRODUCT_SCOPE, status: { in: ACCESS_STATUSES }, currentPeriodEnd: { gt: now } }, select: { tier: true, status: true, currentPeriodEnd: true } });
    const counts: Record<string, number> = { PRO: 0, TRAINER_PRO: 0 };
    for (const s of subs) counts[effectiveTier(s, now)] = (counts[effectiveTier(s, now)] ?? 0) + 1;
    for (const [tier, n] of Object.entries(counts)) this.metrics.set('subscription_active_total', { tier }, n);
    return counts;
  }
}
