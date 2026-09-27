import { Inject, Injectable } from '@nestjs/common';
import { assertIdempotencyKey, SubscriptionError } from './subscription.domain';
import { SubscriptionLogger, SubscriptionMetrics } from './subscription.observability';
import { Db, PRISMA } from './subscription.prisma';
import { FinancialIdempotency, writeAudit } from './subscription.support';
import { PaymentProcessor } from './payment-processor.service';
import { TelegramBotClient } from './telegram-bot.client';
import { serializePayment } from './subscription.service';

export interface AdminActor {
  userId: string;
  roles: string[];
  requestId: string;
}

export function isAdmin(roles: string[]) {
  return roles.includes('ADMIN') || roles.includes('SUPER_ADMIN');
}

/** §5.4: возврат только через Admin API, Idempotency-Key, аудит, отдельный Telegram-адаптер. */
@Injectable()
export class RefundService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Db,
    private readonly idempotency: FinancialIdempotency,
    private readonly processor: PaymentProcessor,
    private readonly telegram: TelegramBotClient,
    private readonly metrics: SubscriptionMetrics,
    private readonly logger: SubscriptionLogger,
  ) {}

  async requestRefund(actor: AdminActor, paymentId: string, reason: string, rawKey: unknown) {
    if (!isAdmin(actor.roles)) throw new SubscriptionError(403, 'FORBIDDEN', 'Administrative role is required');
    const key = assertIdempotencyKey(rawKey);
    const idem = await this.idempotency.begin(actor.userId, 'REFUND', key, { paymentId, reason });
    if (idem.replay) return idem.replay.body;

    try {
      const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new SubscriptionError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');

      if (payment.status === 'REFUNDED') {
        // Повторный возврат: во внешний API не отправляется.
        const body = { payment: { id: payment.id, status: 'REFUNDED' } };
        await this.idempotency.complete(idem.recordId, 202, body);
        return body;
      }
      if (!['PAID', 'REFUND_PENDING'].includes(payment.status) || !payment.telegramPaymentChargeId) {
        throw new SubscriptionError(409, 'PAYMENT_NOT_REFUNDABLE', 'Payment cannot be refunded');
      }

      await this.prisma.$transaction(async (tx: Db) => {
        if (payment.status === 'PAID') {
          const upd = await tx.payment.updateMany({ where: { id: payment.id, status: 'PAID', version: payment.version }, data: { status: 'REFUND_PENDING', refundReason: reason, version: { increment: 1 } } });
          if (upd.count !== 1) throw new SubscriptionError(409, 'CONCURRENT_MODIFICATION', 'Payment was modified concurrently, retry');
        }
        const existing = await tx.refundRequest.findUnique({ where: { paymentId: payment.id } });
        if (existing) await tx.refundRequest.update({ where: { id: existing.id }, data: { status: 'PENDING', attempts: { increment: 1 } } });
        else await tx.refundRequest.create({ data: { paymentId: payment.id, actorUserId: actor.userId, reason, status: 'PENDING', attempts: 1 } });
        await writeAudit(tx, { actorUserId: actor.userId, targetUserId: payment.userId, action: 'payment.refund.requested', entityType: 'payment', entityId: payment.id, requestId: actor.requestId, reason, before: { status: payment.status }, after: { status: 'REFUND_PENDING' } });
      });
      this.logger.log('payment.refund.requested', { requestId: actor.requestId, userId: payment.userId, paymentId: payment.id });

      // §API: 202 Accepted + REFUND_PENDING. Вызов Telegram и пересчёт прав — асинхронно, вне HTTP-запроса
      // и вне транзакции; при сбое задача остаётся FAILED и добивается retry-job'ом (retryPendingRefunds).
      const body = { payment: { id: payment.id, status: 'REFUND_PENDING' } };
      await this.idempotency.complete(idem.recordId, 202, body);
      const run = this.executeRefund(payment.id, { actorUserId: actor.userId, requestId: actor.requestId, reason }).catch(() => undefined);
      if (this.awaitExecution) await run;
      return body;
    } catch (e) {
      await this.idempotency.release(idem.recordId);
      throw e;
    }
  }

  /** Для тестов: дождаться фонового исполнения возврата внутри requestRefund. */
  awaitExecution = process.env.NODE_ENV === 'test';

  /**
   * Исполнение возврата: refundStarPayment (идемпотентно для уже возвращённых) → finalizeRefund
   * (payment REFUNDED, подписка/права пересчитаны, audit, outbox). Безопасно вызывать повторно.
   */
  async executeRefund(paymentId: string, ctx: { actorUserId?: string | null; requestId?: string; reason?: string } = {}): Promise<'REFUNDED' | 'FAILED' | 'SKIPPED'> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.status !== 'REFUND_PENDING' || !payment.telegramPaymentChargeId) return 'SKIPPED';
    const reason = ctx.reason ?? payment.refundReason ?? 'OTHER';
    const user = await this.prisma.user.findUnique({ where: { id: payment.userId }, select: { telegramId: true } });
    try {
      await this.telegram.refundStarPayment(String(user.telegramId), payment.telegramPaymentChargeId);
    } catch (e: any) {
      const code = String(e?.code ?? 'TELEGRAM_ERROR');
      if (!/ALREADY_REFUNDED/.test(code)) {
        await this.prisma.$transaction(async (tx: Db) => {
          await tx.refundRequest.updateMany({ where: { paymentId: payment.id }, data: { status: 'FAILED', errorCode: code.slice(0, 80) } });
          await writeAudit(tx, { actorUserId: ctx.actorUserId ?? null, targetUserId: payment.userId, action: 'payment.refund.failed', entityType: 'payment', entityId: payment.id, requestId: ctx.requestId, reason, errorCode: code });
        });
        this.metrics.inc('payment_refund_total', { result: 'FAILED', reason });
        this.logger.log('payment.refund.failed', { requestId: ctx.requestId, paymentId: payment.id, errorCode: code }, 'error');
        return 'FAILED';
      }
    }
    await this.processor.finalizeRefund(payment.id, { reason, actorUserId: ctx.actorUserId ?? undefined, requestId: ctx.requestId });
    await this.prisma.refundRequest.updateMany({ where: { paymentId: payment.id }, data: { status: 'SUCCEEDED', errorCode: null } }).catch(() => undefined);
    return 'REFUNDED';
  }

  /** Retry-job: добивает зависшие (PENDING > 1 мин) и упавшие (FAILED) возвраты, до maxAttempts попыток. */
  async retryPendingRefunds(maxAttempts = 5, limit = 50) {
    const stale = new Date(Date.now() - 60_000);
    const requests = await this.prisma.refundRequest.findMany({
      where: { attempts: { lt: maxAttempts }, OR: [{ status: 'FAILED' }, { status: 'PENDING', updatedAt: { lt: stale } }] },
      take: limit,
    });
    let refunded = 0;
    for (const r of requests) {
      await this.prisma.refundRequest.update({ where: { id: r.id }, data: { attempts: { increment: 1 }, status: 'PENDING' } });
      if ((await this.executeRefund(r.paymentId, { actorUserId: r.actorUserId, requestId: 'refund-retry', reason: r.reason }).catch(() => 'FAILED')) === 'REFUNDED') refunded++;
    }
    return { scanned: requests.length, refunded };
  }

  /** Административное чтение чужой платёжной истории — всегда с аудитом. */
  async listForAdmin(actor: AdminActor, query: { userId?: string; status?: string; limit?: number }) {
    if (!isAdmin(actor.roles)) throw new SubscriptionError(403, 'FORBIDDEN', 'Administrative role is required');
    const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
    const rows = await this.prisma.payment.findMany({
      where: { ...(query.userId ? { userId: query.userId } : {}), ...(query.status ? { status: query.status } : {}) },
      include: { plan: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    await writeAudit(this.prisma, { actorUserId: actor.userId, targetUserId: query.userId ?? null, action: 'admin.payments.read', entityType: 'payment', requestId: actor.requestId, filter: { status: query.status ?? null } });
    return { items: rows.map((p: any) => ({ ...serializePayment(p), userId: p.userId, requiresManualReview: p.requiresManualReview })) };
  }
}
