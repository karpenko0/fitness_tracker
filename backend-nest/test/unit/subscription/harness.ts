import { randomUUID } from 'crypto';
import { EntitlementsService } from '../../../src/subscription/entitlements.service';
import { PaymentProcessor } from '../../../src/subscription/payment-processor.service';
import { RefundService } from '../../../src/subscription/refund.service';
import { SubscriptionLogger, SubscriptionMetrics } from '../../../src/subscription/subscription.observability';
import { SubscriptionScheduler } from '../../../src/subscription/subscription.scheduler';
import { SubscriptionService } from '../../../src/subscription/subscription.service';
import { FinancialIdempotency } from '../../../src/subscription/subscription.support';
import { CreateInvoiceInput, TelegramApiError, TelegramBotClient } from '../../../src/subscription/telegram-bot.client';
import { TelegramWebhookService } from '../../../src/subscription/telegram-webhook.service';
import { FakePrisma } from './fake-prisma';

export const WEBHOOK_SECRET = 'wh_' + 'x'.repeat(40);
export const BOT_TOKEN = '123456:SECRET-BOT-TOKEN-VALUE';

export class FakeTelegram extends TelegramBotClient {
  invoices: CreateInvoiceInput[] = [];
  answers: { id: string; ok: boolean; error?: string }[] = [];
  refunds: { userId: string; chargeId: string }[] = [];
  edits: { userId: string; chargeId: string; isCanceled: boolean }[] = [];
  failInvoice = false;
  failRefund: string | null = null;

  async createInvoiceLink(input: CreateInvoiceInput) {
    if (this.failInvoice) throw new TelegramApiError('TELEGRAM_UNAVAILABLE', 'down');
    this.invoices.push(input);
    return `https://t.me/$inv_${this.invoices.length}`;
  }
  async answerPreCheckoutQuery(id: string, ok: boolean, error?: string) { this.answers.push({ id, ok, error }); }
  async refundStarPayment(userId: string, chargeId: string) {
    if (this.failRefund) throw new TelegramApiError(this.failRefund, 'refund failed');
    this.refunds.push({ userId, chargeId });
  }
  async editUserStarSubscription(userId: string, chargeId: string, isCanceled: boolean) { this.edits.push({ userId, chargeId, isCanceled }); }
}

export const PLAN_IDS = { PRO_MONTHLY: randomUUID(), PRO_QUARTERLY: randomUUID(), TRAINER_PRO_MONTHLY: randomUUID(), OLD: randomUUID() };

export function buildHarness() {
  const prisma = new FakePrisma();
  const config = { get: (k: string) => ({ TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN } as Record<string, string>)[k] } as any;
  const metrics = new SubscriptionMetrics();
  const logger = new SubscriptionLogger();
  logger.captureForTests = true;
  const telegram = new FakeTelegram();
  const idempotency = new FinancialIdempotency(prisma);
  const entitlements = new EntitlementsService(prisma, metrics, logger);
  const processor = new PaymentProcessor(prisma, entitlements, metrics, logger);
  const subscriptions = new SubscriptionService(prisma, entitlements, idempotency, telegram, metrics, logger);
  const refunds = new RefundService(prisma, idempotency, processor, telegram, metrics, logger);
  const webhooks = new TelegramWebhookService(prisma, config, processor, telegram, metrics, logger);
  const scheduler = new SubscriptionScheduler(prisma, config, entitlements, webhooks, metrics, logger);

  const features = ['UNLIMITED_PROGRAMS', 'ADVANCED_PROGRESS'];
  prisma.tables.billingPlan.push(
    { id: PLAN_IDS.PRO_MONTHLY, code: 'PRO_MONTHLY', tier: 'PRO', title: 'FitTracker Pro — 30 дней', periodDays: 30, amountStars: 399, currency: 'XTR', features, isActive: true, autoRenewable: true, version: 1, createdAt: new Date(), updatedAt: new Date() },
    { id: PLAN_IDS.PRO_QUARTERLY, code: 'PRO_QUARTERLY', tier: 'PRO', title: 'FitTracker Pro — 90 дней', periodDays: 90, amountStars: 999, currency: 'XTR', features, isActive: true, autoRenewable: false, version: 1, createdAt: new Date(), updatedAt: new Date() },
    { id: PLAN_IDS.TRAINER_PRO_MONTHLY, code: 'TRAINER_PRO_MONTHLY', tier: 'TRAINER_PRO', title: 'Trainer Pro — 30 дней', periodDays: 30, amountStars: 899, currency: 'XTR', features: [...features, 'TRAINER_CLIENTS'], isActive: true, autoRenewable: true, version: 1, createdAt: new Date(), updatedAt: new Date() },
    { id: PLAN_IDS.OLD, code: 'PRO_LEGACY', tier: 'PRO', title: 'Old', periodDays: 30, amountStars: 299, currency: 'XTR', features, isActive: false, autoRenewable: false, version: 1, createdAt: new Date(), updatedAt: new Date() },
  );
  prisma.tables.role.push({ id: 'role-trainer', code: 'TRAINER' }, { id: 'role-user', code: 'USER' }, { id: 'role-admin', code: 'ADMIN' });

  let tg = 1000;
  let updateId = 1;
  const addUser = (opts: { roles?: string[]; status?: string; onboarding?: boolean } = {}) => {
    const id = randomUUID();
    const telegramId = BigInt(++tg);
    prisma.tables.user.push({ id, telegramId, status: opts.status ?? 'ACTIVE', deletedAt: null, createdAt: new Date(), updatedAt: new Date() });
    prisma.tables.userProfile.push({ id: randomUUID(), userId: id, onboardingCompleted: opts.onboarding ?? true });
    for (const r of opts.roles ?? ['USER']) prisma.tables.userRole.push({ userId: id, roleId: `role-${r.toLowerCase()}` });
    return { userId: id, telegramId, requestId: `req_${id.slice(0, 8)}` };
  };

  /** Извлекает raw invoice payload, отправленный в Telegram (только тестовый адаптер его видит). */
  const lastPayload = () => telegram.invoices[telegram.invoices.length - 1].payload;

  const post = (update: any) => webhooks.handle(WEBHOOK_SECRET, undefined, update, JSON.stringify(update, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)).length);
  const nextUpdateId = () => updateId++;

  const preCheckout = (user: { telegramId: bigint }, payload: string, amount: number, extra: any = {}) => ({
    update_id: nextUpdateId(),
    pre_checkout_query: { id: `pcq_${updateId}`, from: { id: Number(user.telegramId), first_name: 'Ivan', username: 'ivan' }, currency: 'XTR', total_amount: amount, invoice_payload: payload, ...extra },
  });

  const successful = (user: { telegramId: bigint }, payload: string, amount: number, chargeId: string, extra: any = {}) => ({
    update_id: nextUpdateId(),
    message: {
      message_id: 1,
      from: { id: Number(user.telegramId), first_name: 'Ivan', username: 'ivan' },
      chat: { id: Number(user.telegramId) },
      successful_payment: { currency: 'XTR', total_amount: amount, invoice_payload: payload, telegram_payment_charge_id: chargeId, provider_payment_charge_id: `prov_${chargeId}`, ...extra },
    },
  });

  const refunded = (user: { telegramId: bigint }, payload: string, amount: number, chargeId: string) => ({
    update_id: nextUpdateId(),
    message: { message_id: 2, from: { id: Number(user.telegramId) }, chat: { id: Number(user.telegramId) }, refunded_payment: { currency: 'XTR', total_amount: amount, invoice_payload: payload, telegram_payment_charge_id: chargeId } },
  });

  /** Полный путь: invoice → pre-checkout → successful_payment. */
  const buy = async (user: { userId: string; telegramId: bigint; requestId: string }, planCode = 'PRO_MONTHLY', chargeId = `charge_${randomUUID()}`, extra: any = {}) => {
    const invoice = await subscriptions.createInvoice(user, { planCode }, `key-${randomUUID()}`);
    const payload = lastPayload();
    await post(preCheckout(user, payload, invoice.amountStars));
    const res = await post(successful(user, payload, invoice.amountStars, chargeId, extra));
    return { invoice, payload, chargeId, res };
  };

  return { prisma, metrics, logger, telegram, idempotency, entitlements, processor, subscriptions, refunds, webhooks, scheduler, addUser, lastPayload, post, preCheckout, successful, refunded, buy, nextUpdateId };
}
