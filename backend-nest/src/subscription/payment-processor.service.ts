import { Inject, Injectable } from '@nestjs/common';
import { ACCESS_STATUSES, PRODUCT_SCOPE, STARS_CURRENCY } from './subscription.catalog';
import { computePeriod, maskId, sha256 } from './subscription.domain';
import { EntitlementsService } from './entitlements.service';
import { SubscriptionLogger, SubscriptionMetrics } from './subscription.observability';
import { Db, isUniqueViolation, OptimisticLockError, PRISMA } from './subscription.prisma';
import { writeAudit, writeOutbox } from './subscription.support';

export const TERMINAL_ATTEMPTS = 1000;

/** Нормализованные данные successful_payment (без PII и без raw invoice_payload). */
export interface SuccessfulPaymentData {
  fromTelegramId: string;
  currency: string;
  totalAmount: number;
  invoicePayloadHash: string;
  telegramPaymentChargeId: string;
  providerPaymentChargeId?: string | null;
  isRecurring: boolean;
  isFirstRecurring: boolean;
  subscriptionExpirationDate?: number | null;
}

export type ProcessOutcome =
  | { result: 'PAID'; paymentId: string; subscriptionId: string | null }
  | { result: 'DUPLICATE'; paymentId: string }
  | { result: 'MANUAL_REVIEW'; paymentId: string; reason: string }
  | { result: 'REJECTED'; reason: string };

@Injectable()
export class PaymentProcessor {
  constructor(
    @Inject(PRISMA) private readonly prisma: Db,
    private readonly entitlements: EntitlementsService,
    private readonly metrics: SubscriptionMetrics,
    private readonly logger: SubscriptionLogger,
  ) {}

  /**
   * §5.2 п.9-10 / §8.6: в одной транзакции — payment PAID, подписка (создание/продление),
   * entitlements, audit, outbox, и (опционально) фиксация статуса webhook-события.
   * Повторный вызов с тем же charge id — no-op (DUPLICATE).
   */
  async applySuccessfulPayment(data: SuccessfulPaymentData, ctx: { webhookEventId?: string; updateId?: string; now?: Date }): Promise<ProcessOutcome> {
    const now = ctx.now ?? new Date();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction((tx: Db) => this.applyInTx(tx, data, ctx, now));
      } catch (e) {
        if (isUniqueViolation(e)) {
          const existing = await this.prisma.payment.findUnique({ where: { telegramPaymentChargeId: data.telegramPaymentChargeId } });
          if (existing) return this.duplicate(existing.id, ctx);
          // Конкурирующая оплата создала подписку (partial unique index) — повторяем как продление.
          if (attempt < 2) continue;
        }
        if (e instanceof OptimisticLockError && attempt < 2) continue;
        throw e;
      }
    }
    throw new OptimisticLockError('payment');
  }

  private async duplicate(paymentId: string, ctx: { webhookEventId?: string; updateId?: string }) {
    this.metrics.inc('payment_duplicate_total', { kind: 'charge_id' });
    this.logger.log('payment.duplicate_ignored', { paymentId, webhookUpdateId: ctx.updateId });
    if (ctx.webhookEventId) {
      await this.prisma.$transaction(async (tx: Db) => {
        await tx.telegramWebhookEvent.update({ where: { id: ctx.webhookEventId }, data: { status: 'PROCESSED', errorCode: 'DUPLICATE_CHARGE', processedAt: new Date() } });
        await writeAudit(tx, { action: 'webhook.duplicate_ignored', entityType: 'payment', entityId: paymentId, webhookUpdateId: ctx.updateId });
      });
    }
    return { result: 'DUPLICATE' as const, paymentId };
  }

  private async markEvent(tx: Db, ctx: { webhookEventId?: string }, status: string, errorCode: string | null) {
    // FAILED из-за бизнес-отказа терминален: recovery его не повторяет (attempts = TERMINAL_ATTEMPTS).
    const terminal = status === 'FAILED' ? { attempts: TERMINAL_ATTEMPTS } : {};
    if (ctx.webhookEventId) await tx.telegramWebhookEvent.update({ where: { id: ctx.webhookEventId }, data: { status, errorCode, processedAt: new Date(), ...terminal } });
  }

  private async applyInTx(tx: Db, d: SuccessfulPaymentData, ctx: { webhookEventId?: string; updateId?: string }, now: Date): Promise<ProcessOutcome> {
    const already = await tx.payment.findUnique({ where: { telegramPaymentChargeId: d.telegramPaymentChargeId } });
    if (already) {
      this.metrics.inc('payment_duplicate_total', { kind: 'charge_id' });
      await this.markEvent(tx, ctx, 'PROCESSED', 'DUPLICATE_CHARGE');
      await writeAudit(tx, { action: 'webhook.duplicate_ignored', entityType: 'payment', entityId: already.id, webhookUpdateId: ctx.updateId });
      this.logger.log('payment.duplicate_ignored', { paymentId: already.id, webhookUpdateId: ctx.updateId });
      return { result: 'DUPLICATE', paymentId: already.id };
    }

    if (d.currency !== STARS_CURRENCY) {
      await this.markEvent(tx, ctx, 'FAILED', 'CURRENCY_MISMATCH');
      await writeAudit(tx, { action: 'webhook.rejected', entityType: 'telegram_webhook_event', entityId: ctx.webhookEventId, reason: 'CURRENCY_MISMATCH' });
      this.metrics.inc('payment_processing_total', { status: 'REJECTED', error_code: 'CURRENCY_MISMATCH' });
      return { result: 'REJECTED', reason: 'CURRENCY_MISMATCH' };
    }

    const original = await tx.payment.findUnique({ where: { invoicePayloadHash: d.invoicePayloadHash }, include: { plan: true } });
    if (!original) {
      await this.markEvent(tx, ctx, 'FAILED', 'PAYLOAD_NOT_FOUND');
      await writeAudit(tx, { action: 'webhook.rejected', entityType: 'telegram_webhook_event', entityId: ctx.webhookEventId, reason: 'PAYLOAD_NOT_FOUND' });
      this.metrics.inc('payment_processing_total', { status: 'FAILED', error_code: 'PAYLOAD_NOT_FOUND' });
      this.logger.log('webhook.processing_failed', { webhookUpdateId: ctx.updateId, errorCode: 'PAYLOAD_NOT_FOUND' }, 'error');
      return { result: 'REJECTED', reason: 'PAYLOAD_NOT_FOUND' };
    }

    const user = await tx.user.findUnique({ where: { id: original.userId }, select: { id: true, status: true, deletedAt: true, telegramId: true } });
    const plan = original.plan;
    const snapshot = original.planSnapshot as any;

    // Продление Telegram-подписки приходит с тем же invoice_payload → новый payment.
    let payment = original;
    const isRenewal = original.status === 'PAID' || original.status === 'REFUND_PENDING' || original.status === 'REFUNDED';
    if (isRenewal) {
      payment = await tx.payment.create({
        data: {
          userId: original.userId,
          planId: original.planId,
          status: 'PENDING',
          amountStars: original.amountStars,
          currency: STARS_CURRENCY,
          invoicePayloadHash: sha256(`renewal:${d.telegramPaymentChargeId}`),
          expiresAt: now,
          isRecurring: true,
          planSnapshot: original.planSnapshot,
        },
        include: { plan: true },
      });
    }

    const reviewReason =
      !user || user.status !== 'ACTIVE' || user.deletedAt ? 'ACCOUNT_INACTIVE'
        : String(user.telegramId) !== d.fromTelegramId ? 'USER_MISMATCH'
          : d.totalAmount !== payment.amountStars ? 'AMOUNT_MISMATCH'
            : null;

    const payUpd = await tx.payment.updateMany({
      where: { id: payment.id, version: payment.version, status: { in: ['PENDING', 'FAILED', 'CANCELLED'] } },
      data: {
        status: 'PAID',
        paidAt: now,
        telegramPaymentChargeId: d.telegramPaymentChargeId,
        providerPaymentChargeId: d.providerPaymentChargeId ?? null,
        isRecurring: d.isRecurring,
        requiresManualReview: !!reviewReason,
        version: { increment: 1 },
      },
    });
    if (payUpd.count !== 1) throw new OptimisticLockError('payment');

    if (reviewReason) {
      // Бизнес-правило 15: деньги не теряются, доступ не выдаётся автоматически.
      await writeAudit(tx, { targetUserId: original.userId, action: 'payment.manual_review_required', entityType: 'payment', entityId: payment.id, reason: reviewReason, amountStars: d.totalAmount });
      await writeOutbox(tx, 'payment.paid', original.userId, { paymentId: payment.id, manualReview: true });
      await this.markEvent(tx, ctx, 'PROCESSED', `MANUAL_REVIEW_${reviewReason}`);
      this.metrics.inc('payment_processing_total', { status: 'MANUAL_REVIEW', error_code: reviewReason });
      this.logger.log('payment.manual_review', { userId: original.userId, paymentId: payment.id, errorCode: reviewReason }, 'warn');
      return { result: 'MANUAL_REVIEW', paymentId: payment.id, reason: reviewReason };
    }

    const current = await tx.subscription.findFirst({ where: { userId: original.userId, productScope: PRODUCT_SCOPE, status: { in: ACCESS_STATUSES } } });
    const periodDays: number = snapshot?.periodDays ?? plan.periodDays;
    let subscriptionId: string;
    let event: 'subscription.activated' | 'subscription.renewed';

    if (current && current.tier !== plan.tier) {
      // Смена тарифа без перерасчёта не поддерживается; платёж требует ручной обработки.
      await tx.payment.update({ where: { id: payment.id }, data: { requiresManualReview: true } });
      await writeAudit(tx, { targetUserId: original.userId, action: 'payment.manual_review_required', entityType: 'payment', entityId: payment.id, reason: 'PLAN_CHANGE_NOT_SUPPORTED' });
      await this.markEvent(tx, ctx, 'PROCESSED', 'MANUAL_REVIEW_PLAN_CHANGE');
      return { result: 'MANUAL_REVIEW', paymentId: payment.id, reason: 'PLAN_CHANGE_NOT_SUPPORTED' };
    }

    const autoRenewFromTelegram = d.isRecurring || !!d.subscriptionExpirationDate;
    if (current && current.currentPeriodEnd && current.currentPeriodEnd.getTime() > now.getTime()) {
      const { end } = computePeriod(now, periodDays, current.currentPeriodEnd);
      const upd = await tx.subscription.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          currentPeriodEnd: end,
          ...(autoRenewFromTelegram ? { status: 'ACTIVE', autoRenew: true, telegramSubscriptionChargeId: d.isFirstRecurring ? d.telegramPaymentChargeId : current.telegramSubscriptionChargeId ?? d.telegramPaymentChargeId, cancelledAt: null } : {}),
          version: { increment: 1 },
        },
      });
      if (upd.count !== 1) throw new OptimisticLockError('subscription');
      subscriptionId = current.id;
      event = 'subscription.renewed';
    } else {
      if (current) {
        // Просроченная, но ещё не обработанная job подписка: закрываем перед новой.
        await tx.subscription.updateMany({ where: { id: current.id, version: current.version }, data: { status: 'EXPIRED', expiredAt: now, version: { increment: 1 } } });
      }
      const { start, end } = computePeriod(now, periodDays, null);
      const created = await tx.subscription.create({
        data: {
          userId: original.userId,
          planId: plan.id,
          tier: plan.tier,
          productScope: PRODUCT_SCOPE,
          status: 'ACTIVE',
          autoRenew: autoRenewFromTelegram,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          telegramSubscriptionChargeId: autoRenewFromTelegram ? d.telegramPaymentChargeId : null,
        },
      });
      subscriptionId = created.id;
      event = 'subscription.activated';
    }

    await tx.payment.update({ where: { id: payment.id }, data: { subscriptionId } });
    await this.entitlements.recompute(tx, original.userId, now);
    await writeAudit(tx, { targetUserId: original.userId, action: 'payment.paid', entityType: 'payment', entityId: payment.id, subscriptionId, planCode: plan.code, amountStars: payment.amountStars, chargeId: maskId(d.telegramPaymentChargeId), renewal: isRenewal });
    await writeOutbox(tx, 'payment.paid', original.userId, { paymentId: payment.id, planCode: plan.code, amountStars: payment.amountStars });
    await writeOutbox(tx, event, original.userId, { subscriptionId, tier: plan.tier });
    await this.markEvent(tx, ctx, 'PROCESSED', null);

    this.metrics.inc('telegram_successful_payment_total', { plan_code: plan.code });
    this.metrics.inc('payment_processing_total', { status: 'PAID', error_code: 'NONE' });
    this.logger.log('payment.paid', { userId: original.userId, paymentId: payment.id, subscriptionId, webhookUpdateId: ctx.updateId });
    this.logger.log(event === 'subscription.activated' ? 'subscription.activated' : 'subscription.renewed', { userId: original.userId, subscriptionId });
    return { result: 'PAID', paymentId: payment.id, subscriptionId };
  }

  /**
   * §5.4 п.4 / бизнес-правило 12: платёж → REFUNDED, отзыв периода, выданного этим платежом,
   * и пересчёт прав по актуальной подписке. Идемпотентно.
   */
  async finalizeRefund(paymentId: string, ctx: { reason?: string; actorUserId?: string | null; requestId?: string; webhookEventId?: string; now?: Date }) {
    const now = ctx.now ?? new Date();
    return this.prisma.$transaction(async (tx: Db) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { plan: true } });
      if (!payment) return { status: 'NOT_FOUND' as const };
      if (payment.status === 'REFUNDED') {
        await this.markEvent(tx, ctx, 'PROCESSED', 'ALREADY_REFUNDED');
        return { status: 'REFUNDED' as const, payment, alreadyRefunded: true };
      }
      const upd = await tx.payment.updateMany({
        where: { id: payment.id, version: payment.version, status: { in: ['PAID', 'REFUND_PENDING'] } },
        data: { status: 'REFUNDED', refundedAt: now, refundReason: ctx.reason ?? payment.refundReason ?? 'TELEGRAM_REFUND', version: { increment: 1 } },
      });
      if (upd.count !== 1) throw new OptimisticLockError('payment');

      if (payment.subscriptionId) {
        const sub = await tx.subscription.findUnique({ where: { id: payment.subscriptionId } });
        if (sub && ACCESS_STATUSES.includes(sub.status)) {
          const periodDays: number = (payment.planSnapshot as any)?.periodDays ?? payment.plan.periodDays;
          const otherPaid = await tx.payment.count({ where: { subscriptionId: sub.id, status: 'PAID', id: { not: payment.id } } });
          const newEnd = new Date(sub.currentPeriodEnd.getTime() - periodDays * 86_400_000);
          const keep = otherPaid > 0 && newEnd.getTime() > now.getTime();
          await tx.subscription.update({
            where: { id: sub.id },
            data: keep
              ? { currentPeriodEnd: newEnd, version: { increment: 1 } }
              : { status: 'REFUNDED', refundedAt: now, autoRenew: false, version: { increment: 1 } },
          });
        }
      }
      await tx.refundRequest.updateMany({ where: { paymentId: payment.id }, data: { status: 'SUCCEEDED', errorCode: null } });
      await this.entitlements.recompute(tx, payment.userId, now);
      await writeAudit(tx, { actorUserId: ctx.actorUserId ?? null, targetUserId: payment.userId, action: 'payment.refunded', entityType: 'payment', entityId: payment.id, requestId: ctx.requestId, reason: ctx.reason, before: { status: payment.status }, after: { status: 'REFUNDED' } });
      await writeOutbox(tx, 'payment.refunded', payment.userId, { paymentId: payment.id, subscriptionId: payment.subscriptionId });
      await this.markEvent(tx, ctx, 'PROCESSED', null);
      this.metrics.inc('payment_refund_total', { result: 'SUCCEEDED', reason: ctx.reason ?? 'TELEGRAM_REFUND' });
      this.logger.log('payment.refunded', { requestId: ctx.requestId, userId: payment.userId, paymentId: payment.id });
      return { status: 'REFUNDED' as const, payment, alreadyRefunded: false };
    });
  }
}
