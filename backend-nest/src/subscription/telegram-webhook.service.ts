import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { WEBHOOK_MAX_BODY_BYTES } from './subscription.catalog';
import { sha256, stableHash, verifyPreCheckout } from './subscription.domain';
import { SubscriptionLogger, SubscriptionMetrics } from './subscription.observability';
import { Db, isUniqueViolation, PRISMA } from './subscription.prisma';
import { writeAudit } from './subscription.support';
import { PaymentProcessor, SuccessfulPaymentData, TERMINAL_ATTEMPTS } from './payment-processor.service';
import { TelegramBotClient } from './telegram-bot.client';

export type WebhookHttpResult = { httpStatus: 200 | 400 | 404 | 413 | 500 };

type EventType = 'pre_checkout_query' | 'successful_payment' | 'refunded_payment' | 'unsupported';

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

@Injectable()
export class TelegramWebhookService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Db,
    private readonly config: ConfigService,
    private readonly processor: PaymentProcessor,
    private readonly telegram: TelegramBotClient,
    private readonly metrics: SubscriptionMetrics,
    private readonly logger: SubscriptionLogger,
  ) {}

  verifySecret(pathSecret: string | undefined, headerSecret: string | undefined): boolean {
    const expected = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    if (!expected || expected.length < 32 || !pathSecret) return false;
    if (!safeEqual(pathSecret, expected)) return false;
    const headerExpected = this.config.get<string>('TELEGRAM_WEBHOOK_HEADER_SECRET');
    if (headerExpected && (!headerSecret || !safeEqual(headerSecret, headerExpected))) return false;
    return true;
  }

  classify(update: any): EventType {
    if (update?.pre_checkout_query) return 'pre_checkout_query';
    if (update?.message?.successful_payment) return 'successful_payment';
    if (update?.message?.refunded_payment) return 'refunded_payment';
    return 'unsupported';
  }

  /** Минимально необходимые данные без PII; raw invoice_payload заменён хешем. */
  normalize(type: EventType, update: any): Record<string, unknown> {
    if (type === 'pre_checkout_query') {
      const q = update.pre_checkout_query;
      return { queryId: String(q.id), fromTelegramId: String(q.from?.id), currency: q.currency, totalAmount: q.total_amount, invoicePayloadHash: sha256(String(q.invoice_payload ?? '')) };
    }
    if (type === 'successful_payment') {
      const p = update.message.successful_payment;
      return {
        fromTelegramId: String(update.message.from?.id ?? update.message.chat?.id),
        currency: p.currency,
        totalAmount: p.total_amount,
        invoicePayloadHash: sha256(String(p.invoice_payload ?? '')),
        telegramPaymentChargeId: p.telegram_payment_charge_id,
        providerPaymentChargeId: p.provider_payment_charge_id ?? null,
        isRecurring: !!p.is_recurring,
        isFirstRecurring: !!p.is_first_recurring,
        subscriptionExpirationDate: p.subscription_expiration_date ?? null,
      };
    }
    if (type === 'refunded_payment') {
      const r = update.message.refunded_payment;
      return { currency: r.currency, totalAmount: r.total_amount, invoicePayloadHash: sha256(String(r.invoice_payload ?? '')), telegramPaymentChargeId: r.telegram_payment_charge_id };
    }
    return {};
  }

  validStructure(type: EventType, update: any): boolean {
    if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) return false;
    if (type === 'pre_checkout_query') {
      const q = update.pre_checkout_query;
      return typeof q.id === 'string' && q.from && typeof q.currency === 'string' && Number.isInteger(q.total_amount) && typeof q.invoice_payload === 'string';
    }
    if (type === 'successful_payment') {
      const p = update.message.successful_payment;
      return typeof p.currency === 'string' && Number.isInteger(p.total_amount) && typeof p.invoice_payload === 'string' && typeof p.telegram_payment_charge_id === 'string' && p.telegram_payment_charge_id.length > 0 && p.telegram_payment_charge_id.length <= 255;
    }
    if (type === 'refunded_payment') {
      const r = update.message.refunded_payment;
      return typeof r.telegram_payment_charge_id === 'string' && r.telegram_payment_charge_id.length > 0;
    }
    return true;
  }

  async handle(pathSecret: string | undefined, headerSecret: string | undefined, update: any, bodyBytes: number, requestId?: string): Promise<WebhookHttpResult> {
    const started = Date.now();
    if (!this.verifySecret(pathSecret, headerSecret)) {
      this.logger.log('webhook.invalid_secret', { requestId }, 'warn');
      this.metrics.inc('payment_processing_total', { status: 'REJECTED', error_code: 'INVALID_SECRET' });
      return { httpStatus: 404 };
    }
    if (bodyBytes > WEBHOOK_MAX_BODY_BYTES) return { httpStatus: 413 };
    const type = this.classify(update);
    if (!update || typeof update !== 'object' || !this.validStructure(type, update)) {
      this.logger.log('webhook.processing_failed', { requestId, errorCode: 'INVALID_STRUCTURE' }, 'warn');
      return { httpStatus: 400 };
    }

    // 1. Фиксация события до бизнес-обработки + дедупликация по update_id.
    const normalized = this.normalize(type, update);
    let event: any;
    try {
      event = await this.prisma.telegramWebhookEvent.create({
        data: { updateId: BigInt(update.update_id), eventType: type, payload: normalized, payloadHash: stableHash(normalized), status: type === 'unsupported' ? 'IGNORED' : 'RECEIVED', processedAt: type === 'unsupported' ? new Date() : null },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      event = await this.prisma.telegramWebhookEvent.findUnique({ where: { updateId: BigInt(update.update_id) } });
      if (event.status === 'PROCESSED' || event.status === 'IGNORED') {
        this.metrics.inc('payment_duplicate_total', { kind: 'update_id' });
        this.logger.log('payment.duplicate_ignored', { requestId, webhookUpdateId: update.update_id });
        await this.prisma.auditLog.create({ data: { action: 'webhook.duplicate_ignored', entityType: 'telegram_webhook_event', entityId: event.id, metadata: { updateId: String(update.update_id) } } });
        return { httpStatus: 200 };
      }
      // RECEIVED/FAILED: повторная доставка — идемпотентно дообрабатываем.
    }
    if (type === 'unsupported') return { httpStatus: 200 };

    try {
      await this.process(event, requestId);
      this.metrics.observe('webhook_processing_duration_seconds', { event_type: type, result: 'ok' }, (Date.now() - started) / 1000);
      return { httpStatus: 200 };
    } catch (e: any) {
      await this.markFailed(event.id, e?.code ?? 'PROCESSING_ERROR');
      this.logger.log('webhook.processing_failed', { requestId, webhookUpdateId: update.update_id, errorCode: e?.code ?? 'PROCESSING_ERROR' }, 'error');
      this.metrics.observe('webhook_processing_duration_seconds', { event_type: type, result: 'error' }, (Date.now() - started) / 1000);
      // pre-checkout: Telegram не ретраит, ответ уже отправлен/не отправлен; платёжные события — вернуть 500 для повторной доставки.
      return { httpStatus: type === 'pre_checkout_query' ? 200 : 500 };
    }
  }

  private async markFailed(eventId: string, errorCode: string) {
    await this.prisma.telegramWebhookEvent.update({ where: { id: eventId }, data: { status: 'FAILED', errorCode: String(errorCode).slice(0, 80), attempts: { increment: 1 } } }).catch(() => undefined);
  }

  /** Идемпотентная бизнес-обработка сохранённого события (используется и recovery-воркером). */
  async process(event: any, requestId?: string) {
    const data = event.payload as any;
    if (event.eventType === 'pre_checkout_query') return this.processPreCheckout(event, data, requestId);
    if (event.eventType === 'successful_payment') {
      this.logger.log('payment.successful.received', { requestId, webhookUpdateId: String(event.updateId) });
      return this.processor.applySuccessfulPayment(data as SuccessfulPaymentData, { webhookEventId: event.id, updateId: String(event.updateId) });
    }
    if (event.eventType === 'refunded_payment') {
      const payment = await this.prisma.payment.findUnique({ where: { telegramPaymentChargeId: data.telegramPaymentChargeId } });
      if (!payment) {
        await this.prisma.telegramWebhookEvent.update({ where: { id: event.id }, data: { status: 'FAILED', errorCode: 'PAYMENT_NOT_FOUND', processedAt: new Date(), attempts: TERMINAL_ATTEMPTS } });
        return;
      }
      return this.processor.finalizeRefund(payment.id, { reason: 'TELEGRAM_REFUND', webhookEventId: event.id });
    }
  }

  /** §5.2 п.7-8: быстрые локальные проверки, при сомнении — отказ. */
  private async processPreCheckout(event: any, q: any, requestId?: string) {
    const now = new Date();
    const payment = await this.prisma.payment.findUnique({ where: { invoicePayloadHash: q.invoicePayloadHash } });
    const user = payment ? await this.prisma.user.findUnique({ where: { id: payment.userId }, select: { telegramId: true, status: true, deletedAt: true } }) : null;
    const reason = verifyPreCheckout(
      { id: q.queryId, from: { id: q.fromTelegramId }, currency: q.currency, total_amount: q.totalAmount, invoice_payload: '' },
      payment && user ? { status: payment.status, amountStars: payment.amountStars, currency: payment.currency, userTelegramId: user.telegramId, expiresAt: payment.expiresAt, userActive: user.status === 'ACTIVE' && !user.deletedAt } : null,
      now,
    );
    await this.telegram.answerPreCheckoutQuery(q.queryId, reason === null, reason ? 'Платёж не может быть выполнен. Создайте новый счёт в приложении.' : undefined);
    await this.prisma.$transaction(async (tx: Db) => {
      await tx.telegramWebhookEvent.update({ where: { id: event.id }, data: { status: reason ? 'IGNORED' : 'PROCESSED', errorCode: reason, processedAt: now } });
      if (reason) await writeAudit(tx, { targetUserId: payment?.userId ?? null, action: 'payment.pre_checkout.rejected', entityType: 'payment', entityId: payment?.id ?? null, reason, requestId });
    });
    this.metrics.inc('telegram_pre_checkout_total', { result: reason ? 'rejected' : 'approved', reason: reason ?? 'OK' });
    this.logger.log(reason ? 'payment.pre_checkout.rejected' : 'payment.pre_checkout.approved', { requestId, paymentId: payment?.id, userId: payment?.userId, errorCode: reason ?? undefined }, reason ? 'warn' : 'info');
  }

  /** Recovery: доводит RECEIVED/FAILED события до терминального статуса (после рестарта/сбоя). */
  async recoverPending(limit = 100, maxAttempts = 10) {
    const olderThan = new Date(Date.now() - 5_000);
    const events = await this.prisma.telegramWebhookEvent.findMany({
      where: { status: { in: ['RECEIVED', 'FAILED'] }, eventType: { in: ['successful_payment', 'refunded_payment'] }, attempts: { lt: maxAttempts }, createdAt: { lt: olderThan } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    let processed = 0;
    for (const event of events) {
      try {
        await this.process(event, 'recovery');
        processed++;
      } catch (e: any) {
        await this.markFailed(event.id, e?.code ?? 'PROCESSING_ERROR');
      }
    }
    // pre-checkout, не обработанный в срок, больше не актуален.
    await this.prisma.telegramWebhookEvent.updateMany({ where: { status: 'RECEIVED', eventType: 'pre_checkout_query', createdAt: { lt: new Date(Date.now() - 60_000) } }, data: { status: 'IGNORED', errorCode: 'PRE_CHECKOUT_TIMEOUT', processedAt: new Date() } });
    return { scanned: events.length, processed };
  }
}
