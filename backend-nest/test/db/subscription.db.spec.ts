/**
 * SPEC-010 integration tests against a REAL PostgreSQL with the real Prisma query engine.
 * Skipped unless SUBSCRIPTION_DB_TEST_URL is set. The database must have all migrations applied
 * (`prisma migrate deploy`). Optional SUBSCRIPTION_PRISMA_CLIENT points to an alternative generated
 * client module (e.g. a driverAdapters/wasm build) — then the `pg` adapter is used.
 *
 *   SUBSCRIPTION_DB_TEST_URL=postgresql://... npx jest test/db
 */
import { randomUUID } from 'crypto';
import { EntitlementsService } from '../../src/subscription/entitlements.service';
import { PaymentProcessor } from '../../src/subscription/payment-processor.service';
import { RefundService } from '../../src/subscription/refund.service';
import { SubscriptionLogger, SubscriptionMetrics } from '../../src/subscription/subscription.observability';
import { SubscriptionScheduler } from '../../src/subscription/subscription.scheduler';
import { SubscriptionService } from '../../src/subscription/subscription.service';
import { FinancialIdempotency } from '../../src/subscription/subscription.support';
import { TelegramWebhookService } from '../../src/subscription/telegram-webhook.service';
import { FakeTelegram, WEBHOOK_SECRET } from '../unit/subscription/harness';

const URL = process.env.SUBSCRIPTION_DB_TEST_URL;
const d = URL ? describe : describe.skip;
const DAY = 86_400_000;
const key = () => `key-${randomUUID()}`;

let pool: any;
function createPrisma() {
  const clientPath = process.env.SUBSCRIPTION_PRISMA_CLIENT;
  if (clientPath) {
    const { Pool } = require('pg');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const { PrismaClient } = require(clientPath);
    pool = new Pool({ connectionString: URL, max: 10 });
    return new PrismaClient({ adapter: new PrismaPg(pool) });
  }
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({ datasources: { db: { url: URL } } });
}

d('SPEC-010 on real PostgreSQL', () => {
  jest.setTimeout(60_000);
  let prisma: any;
  let telegram: FakeTelegram;
  let subs: SubscriptionService;
  let webhooks: TelegramWebhookService;
  let refunds: RefundService;
  let scheduler: SubscriptionScheduler;
  let payloads: string[];
  let updateId = Math.floor(Date.now() / 1000) * 1000;

  beforeAll(async () => {
    prisma = createPrisma();
    const config = { get: (k: string) => (k === 'TELEGRAM_WEBHOOK_SECRET' ? WEBHOOK_SECRET : undefined) } as any;
    const metrics = new SubscriptionMetrics();
    const logger = new SubscriptionLogger();
    logger.captureForTests = true;
    telegram = new FakeTelegram();
    const idem = new FinancialIdempotency(prisma);
    const ent = new EntitlementsService(prisma, metrics, logger);
    const proc = new PaymentProcessor(prisma, ent, metrics, logger);
    subs = new SubscriptionService(prisma, ent, idem, telegram, metrics, logger);
    refunds = new RefundService(prisma, idem, proc, telegram, metrics, logger);
    webhooks = new TelegramWebhookService(prisma, config, proc, telegram, metrics, logger);
    scheduler = new SubscriptionScheduler(prisma, config, ent, webhooks, metrics, logger);
    payloads = [];
    const orig = telegram.createInvoiceLink.bind(telegram);
    telegram.createInvoiceLink = async (i: any) => { payloads.push(i.payload); return orig(i); };
  });

  afterAll(async () => { await prisma?.$disconnect(); await pool?.end(); });

  async function user(roles: string[] = ['USER'], status = 'ACTIVE') {
    const id = randomUUID();
    const telegramId = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    await prisma.$executeRawUnsafe(`INSERT INTO "User"("id","telegramId","firstName","status") VALUES ($1::uuid,$2,'Test',$3)`, id, telegramId, status);
    for (const code of roles) {
      await prisma.$executeRawUnsafe(`INSERT INTO "Role"("id","code","name") VALUES (gen_random_uuid(),$1,$1) ON CONFLICT ("code") DO NOTHING`, code);
      await prisma.$executeRawUnsafe(`INSERT INTO "UserRole"("userId","roleId") SELECT $1::uuid, "id" FROM "Role" WHERE "code"=$2`, id, code);
    }
    return { userId: id, telegramId, requestId: 'req_db' };
  }

  const successful = (u: any, payload: string, amount: number, charge: string, extra: any = {}) => ({
    update_id: ++updateId,
    message: { message_id: 1, from: { id: Number(u.telegramId) }, chat: { id: Number(u.telegramId) }, successful_payment: { currency: 'XTR', total_amount: amount, invoice_payload: payload, telegram_payment_charge_id: charge, ...extra } },
  });
  const post = (upd: any) => webhooks.handle(WEBHOOK_SECRET, undefined, upd, 500);

  async function buy(u: any, plan = 'PRO_MONTHLY', charge = `ch_${randomUUID()}`) {
    const inv = await subs.createInvoice(u, { planCode: plan }, key());
    const payload = payloads[payloads.length - 1];
    await post({ update_id: ++updateId, pre_checkout_query: { id: `q${updateId}`, from: { id: Number(u.telegramId) }, currency: 'XTR', total_amount: inv.amountStars, invoice_payload: payload } });
    const res = await post(successful(u, payload, inv.amountStars, charge));
    return { inv, payload, charge, res };
  }

  it('published plans are seeded by the migration', async () => {
    const u = await user();
    const codes = (await subs.listPlans(u)).plans.map((p: any) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['PRO_MONTHLY', 'PRO_QUARTERLY']));
    expect(codes).not.toContain('TRAINER_PRO_MONTHLY');
  });

  it('full purchase: PAID payment, ACTIVE subscription, entitlements, legacy limits, audit, outbox', async () => {
    const u = await user();
    const { inv, res } = await buy(u);
    expect(res.httpStatus).toBe(200);
    expect(telegram.answers[telegram.answers.length - 1].ok).toBe(true);
    const p = await prisma.payment.findUnique({ where: { id: inv.paymentId } });
    expect(p.status).toBe('PAID');
    const me = await subs.getMe(u);
    expect(me.effectiveTier).toBe('PRO');
    expect(await prisma.userEntitlement.count({ where: { userId: u.userId } })).toBeGreaterThan(0);
    const legacy = await prisma.$queryRawUnsafe(`SELECT "plan"::text AS plan FROM "SubscriptionEntitlement" WHERE "userId"=$1::uuid`, u.userId);
    expect(legacy[0].plan).toBe('PRO');
    const outbox = await prisma.$queryRawUnsafe(`SELECT "type" FROM "OutboxEvent" WHERE "userId"=$1::uuid`, u.userId);
    expect(outbox.map((r: any) => r.type)).toEqual(expect.arrayContaining(['payment.paid', 'subscription.activated']));
  });

  it('parallel duplicate successful_payment → exactly one PAID payment and one period', async () => {
    const u = await user();
    const inv = await subs.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key());
    const payload = payloads[payloads.length - 1];
    const charge = `ch_${randomUUID()}`;
    const a = successful(u, payload, inv.amountStars, charge);
    const b = successful(u, payload, inv.amountStars, charge);
    await Promise.all([post(a), post(a), post(b), post(b)]);
    expect(await prisma.payment.count({ where: { userId: u.userId, status: 'PAID' } })).toBe(1);
    const s = await prisma.subscription.findMany({ where: { userId: u.userId } });
    expect(s).toHaveLength(1);
    expect(s[0].currentPeriodEnd.getTime() - s[0].currentPeriodStart.getTime()).toBe(30 * DAY);
  });

  it('two different parallel payments for one user serialize into one extended subscription', async () => {
    const u = await user();
    const i1 = await subs.createInvoice(u, { planCode: 'PRO_QUARTERLY' }, key());
    const p1 = payloads[payloads.length - 1];
    const i2 = await subs.createInvoice(u, { planCode: 'PRO_QUARTERLY' }, key());
    const p2 = payloads[payloads.length - 1];
    await Promise.all([post(successful(u, p1, i1.amountStars, `ch_${randomUUID()}`)), post(successful(u, p2, i2.amountStars, `ch_${randomUUID()}`))]);
    await webhooks.recoverPending(); // на случай FAILED из-за гонки
    const s = await prisma.subscription.findMany({ where: { userId: u.userId, status: { in: ['ACTIVE', 'EXPIRING'] } } });
    expect(s).toHaveLength(1);
    expect(await prisma.payment.count({ where: { userId: u.userId, status: 'PAID' } })).toBe(2);
    expect(s[0].currentPeriodEnd.getTime() - s[0].currentPeriodStart.getTime()).toBe(180 * DAY);
  });

  it('DB enforces one ACTIVE/EXPIRING subscription per user (partial unique index)', async () => {
    const u = await user();
    await buy(u);
    const plan = await prisma.billingPlan.findUnique({ where: { code: 'PRO_MONTHLY' } });
    await expect(prisma.subscription.create({ data: { userId: u.userId, planId: plan.id, tier: 'PRO', status: 'EXPIRING', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + DAY) } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('DB rejects in-place price change of a published plan and non-XTR currency', async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "subscription_plans" SET "amount_stars" = 1 WHERE "code"='PRO_MONTHLY'`)).rejects.toThrow(/PLAN_PRICE_IMMUTABLE/);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "subscription_plans"("id","code","tier","title","period_days","amount_stars","currency","features") VALUES (gen_random_uuid(),'X_USD','PRO','x',30,10,'USD','[]')`)).rejects.toThrow();
  });

  it('idempotent invoice: same key → same payment; other body → 409', async () => {
    const u = await user();
    const k = key();
    const a = await subs.createInvoice(u, { planCode: 'PRO_MONTHLY' }, k);
    const b = await subs.createInvoice(u, { planCode: 'PRO_MONTHLY' }, k);
    expect(b.paymentId).toBe(a.paymentId);
    await expect(subs.createInvoice(u, { planCode: 'PRO_QUARTERLY' }, k)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('TRAINER_PRO needs TRAINER; trainer gets Trainer Pro entitlements', async () => {
    const u = await user();
    await expect(subs.createInvoice(u, { planCode: 'TRAINER_PRO_MONTHLY' }, key())).rejects.toMatchObject({ code: 'TRAINER_ROLE_REQUIRED' });
    const t = await user(['TRAINER']);
    await buy(t, 'TRAINER_PRO_MONTHLY');
    expect((await subs.getMe(t)).entitlements).toContain('TRAINER_CLIENTS');
  });

  it('refund → REFUNDED + access revoked; repeat does not call Telegram', async () => {
    const u = await user();
    const admin = await user(['ADMIN']);
    const { inv } = await buy(u);
    const before = telegram.refunds.length;
    const k = key();
    await refunds.requestRefund({ userId: admin.userId, roles: ['ADMIN'], requestId: 'r' }, inv.paymentId, 'DUPLICATE_CHARGE', k);
    await refunds.requestRefund({ userId: admin.userId, roles: ['ADMIN'], requestId: 'r' }, inv.paymentId, 'DUPLICATE_CHARGE', key());
    expect(telegram.refunds.length).toBe(before + 1);
    expect((await prisma.payment.findUnique({ where: { id: inv.paymentId } })).status).toBe('REFUNDED');
    expect((await subs.getMe(u)).effectiveTier).toBe('FREE');
  });

  it('expiration job moves subscription to EXPIRED and is re-runnable', async () => {
    const u = await user();
    await buy(u);
    const future = new Date(Date.now() + 31 * DAY);
    await scheduler.expireDue(future);
    const s = await prisma.subscription.findFirst({ where: { userId: u.userId } });
    expect(s.status).toBe('EXPIRED');
    expect(await prisma.userEntitlement.count({ where: { userId: u.userId } })).toBe(0);
    await scheduler.expireDue(future);
  });

  it('webhook update_id is unique; a replay after processing is ignored', async () => {
    const u = await user();
    const { inv, payload, charge } = await buy(u);
    const upd = successful(u, payload, inv.amountStars, charge);
    await post(upd);
    await post(upd);
    expect(await prisma.telegramWebhookEvent.count({ where: { updateId: BigInt(upd.update_id) } })).toBe(1);
    expect(await prisma.payment.count({ where: { userId: u.userId, status: 'PAID' } })).toBe(1);
  });

  it('blocked user: invoice 403; incoming payment recorded for manual review without access', async () => {
    const blocked = await user(['USER'], 'BLOCKED');
    await expect(subs.createInvoice(blocked, { planCode: 'PRO_MONTHLY' }, key())).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
    const u = await user();
    const inv = await subs.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key());
    const payload = payloads[payloads.length - 1];
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "status"='BLOCKED' WHERE "id"=$1::uuid`, u.userId);
    await post(successful(u, payload, inv.amountStars, `ch_${randomUUID()}`));
    const p = await prisma.payment.findUnique({ where: { id: inv.paymentId } });
    expect(p).toMatchObject({ status: 'PAID', requiresManualReview: true });
    expect(await prisma.subscription.count({ where: { userId: u.userId } })).toBe(0);
  });
});
