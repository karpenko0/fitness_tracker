import { randomUUID } from 'crypto';
import { BOT_TOKEN, buildHarness, WEBHOOK_SECRET } from './harness';

const DAY = 86_400_000;
const key = () => `key-${randomUUID()}`;

describe('SPEC-010 subscriptions & Telegram Stars (service + in-memory DB)', () => {
  let h: ReturnType<typeof buildHarness>;
  beforeEach(() => { h = buildHarness(); });

  describe('plans, /me, paywall', () => {
    it('FREE by default, no subscription row, paywall not eligible before milestone', async () => {
      const u = h.addUser({ onboarding: false });
      const me = await h.subscriptions.getMe(u);
      expect(me).toEqual({ effectiveTier: 'FREE', entitlements: [], subscription: null, paywallEligibility: { isEligible: false, valueMilestone: null } });
      expect(h.prisma.tables.subscription).toHaveLength(0);
    });

    it('paywall eligible after onboarding + first workout started; ENTITLEMENT_REQUIRED without internals', async () => {
      const u = h.addUser();
      h.prisma.tables.workout.push({ id: randomUUID(), userId: u.userId, status: 'IN_PROGRESS', startedAt: new Date() });
      expect((await h.subscriptions.getMe(u)).paywallEligibility).toEqual({ isEligible: true, valueMilestone: 'FIRST_WORKOUT_STARTED' });
      await expect(h.entitlements.assert(u.userId, 'ADVANCED_PROGRESS')).rejects.toMatchObject({
        httpStatus: 403, code: 'ENTITLEMENT_REQUIRED',
        details: { currentPlan: 'FREE', requiredEntitlement: 'ADVANCED_PROGRESS', paywallContext: { isEligible: true, valueMilestone: 'FIRST_WORKOUT_STARTED' } },
      });
      expect(h.metrics.get('entitlement_denied_total', { entitlement: 'ADVANCED_PROGRESS', current_tier: 'FREE' })).toBe(1);
    });

    it('shows only published plans allowed for the role', async () => {
      const user = h.addUser();
      const trainer = h.addUser({ roles: ['TRAINER'] });
      const codes = (await h.subscriptions.listPlans(user)).plans.map((p: any) => p.code);
      expect(codes).toEqual(expect.arrayContaining(['PRO_MONTHLY', 'PRO_QUARTERLY']));
      expect(codes).not.toContain('TRAINER_PRO_MONTHLY');
      expect(codes).not.toContain('PRO_LEGACY');
      expect((await h.subscriptions.listPlans(trainer)).plans.map((p: any) => p.code)).toContain('TRAINER_PRO_MONTHLY');
    });
  });

  describe('invoice creation', () => {
    it('creates one PENDING payment with server price and opaque payload', async () => {
      const u = h.addUser();
      const inv = await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key());
      expect(inv).toMatchObject({ planCode: 'PRO_MONTHLY', amountStars: 399, currency: 'XTR', status: 'PENDING', invoiceLink: expect.stringContaining('https://t.me/') });
      expect(h.prisma.tables.payment).toHaveLength(1);
      const p = h.prisma.tables.payment[0];
      expect(p.invoicePayloadHash).toHaveLength(64);
      expect(JSON.stringify(p)).not.toContain(h.lastPayload());
      expect(JSON.stringify(inv)).not.toContain(h.lastPayload());
      expect(h.telegram.invoices[0]).toMatchObject({ amountStars: 399, subscriptionPeriodSeconds: 2_592_000 });
      expect(h.prisma.tables.auditLog.some(a => a.action === 'payment.invoice.created')).toBe(true);
    });

    it('same key + same body returns the same paymentId; different body → 409', async () => {
      const u = h.addUser();
      const k = key();
      const a = await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, k);
      const b = await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, k);
      expect(b.paymentId).toBe(a.paymentId);
      expect(h.prisma.tables.payment).toHaveLength(1);
      await expect(h.subscriptions.createInvoice(u, { planCode: 'PRO_QUARTERLY' }, k)).rejects.toMatchObject({ httpStatus: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
    });

    it('requires Idempotency-Key', async () => {
      const u = h.addUser();
      await expect(h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, undefined)).rejects.toMatchObject({ httpStatus: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
    });

    it('TRAINER_PRO without TRAINER role → 403, no payment', async () => {
      const u = h.addUser();
      await expect(h.subscriptions.createInvoice(u, { planCode: 'TRAINER_PRO_MONTHLY' }, key())).rejects.toMatchObject({ httpStatus: 403, code: 'TRAINER_ROLE_REQUIRED' });
      expect(h.prisma.tables.payment).toHaveLength(0);
    });

    it('unknown / unpublished plan → 404', async () => {
      const u = h.addUser();
      await expect(h.subscriptions.createInvoice(u, { planCode: 'PRO_LEGACY' }, key())).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
      await expect(h.subscriptions.createInvoice(u, { planCode: 'NOPE' }, key())).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    });

    it('blocked user → 403 ACCOUNT_INACTIVE', async () => {
      const u = h.addUser({ status: 'BLOCKED' });
      await expect(h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key())).rejects.toMatchObject({ httpStatus: 403, code: 'ACCOUNT_INACTIVE' });
    });

    it('PRO → TRAINER_PRO switch → 422', async () => {
      const u = h.addUser({ roles: ['TRAINER'] });
      await h.buy(u, 'PRO_QUARTERLY');
      await expect(h.subscriptions.createInvoice(u, { planCode: 'TRAINER_PRO_MONTHLY' }, key())).rejects.toMatchObject({ httpStatus: 422, code: 'PLAN_CHANGE_NOT_SUPPORTED' });
    });

    it('Telegram failure marks payment FAILED and the same key can be retried', async () => {
      const u = h.addUser();
      const k = key();
      h.telegram.failInvoice = true;
      await expect(h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, k)).rejects.toMatchObject({ httpStatus: 502 });
      expect(h.prisma.tables.payment[0].status).toBe('FAILED');
      h.telegram.failInvoice = false;
      const ok = await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, k);
      expect(ok.status).toBe('PENDING');
    });
  });

  describe('webhook: pre_checkout_query', () => {
    it('approves matching query', async () => {
      const u = h.addUser();
      const inv = await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key());
      const res = await h.post(h.preCheckout(u, h.lastPayload(), inv.amountStars));
      expect(res.httpStatus).toBe(200);
      expect(h.telegram.answers[0].ok).toBe(true);
      expect(h.prisma.tables.subscription).toHaveLength(0); // pre-checkout не выдаёт доступ
    });

    it.each([
      ['amount', (u: any, p: string) => h.preCheckout(u, p, 1)],
      ['currency', (u: any, p: string) => h.preCheckout(u, p, 399, { currency: 'USD' })],
      ['payload', (u: any) => h.preCheckout(u, 'ft1_forged', 399)],
      ['user', (_u: any, p: string) => h.preCheckout({ telegramId: 999999n }, p, 399)],
    ])('rejects mismatched %s with ok=false and no access', async (_name, build) => {
      const u = h.addUser();
      await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key());
      await h.post(build(u, h.lastPayload()));
      expect(h.telegram.answers[0]).toMatchObject({ ok: false });
      expect(h.telegram.answers[0].error).not.toMatch(/MISMATCH|payload/i);
      expect((await h.subscriptions.getMe(u)).effectiveTier).toBe('FREE');
    });
  });

  describe('webhook: successful_payment', () => {
    it('first delivery → PAID payment, ACTIVE subscription, entitlements, audit, outbox in one go', async () => {
      const u = h.addUser();
      const { invoice } = await h.buy(u);
      const p = h.prisma.tables.payment.find(x => x.id === invoice.paymentId)!;
      expect(p.status).toBe('PAID');
      expect(p.paidAt).toBeInstanceOf(Date);
      const sub = h.prisma.tables.subscription[0];
      expect(sub).toMatchObject({ status: 'ACTIVE', tier: 'PRO', autoRenew: false });
      expect(sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime()).toBe(30 * DAY);
      expect(h.prisma.tables.userEntitlement.map(e => e.entitlement)).toContain('ADVANCED_PROGRESS');
      expect(h.prisma.tables.subscriptionEntitlement[0].plan).toBe('PRO'); // legacy лимиты синхронизированы
      expect(h.prisma.tables.auditLog.some(a => a.action === 'payment.paid')).toBe(true);
      expect(h.prisma.tables.outboxEvent.map(e => e.type)).toEqual(expect.arrayContaining(['payment.paid', 'subscription.activated']));
      const me = await h.subscriptions.getMe(u);
      expect(me.effectiveTier).toBe('PRO');
      expect(me.subscription).toMatchObject({ planCode: 'PRO_MONTHLY', status: 'ACTIVE' });
      expect(h.prisma.tables.telegramWebhookEvent.every(e => e.status === 'PROCESSED')).toBe(true);
    });

    it('duplicate delivery (same update_id) and replay (new update_id, same charge) create nothing new', async () => {
      const u = h.addUser();
      const { payload, chargeId, invoice } = await h.buy(u);
      const endBefore = h.prisma.tables.subscription[0].currentPeriodEnd.getTime();
      const upd = h.successful(u, payload, invoice.amountStars, chargeId);
      await h.post(upd);
      await h.post(upd);
      await h.post(h.successful(u, payload, invoice.amountStars, chargeId));
      expect(h.prisma.tables.payment.filter(p => p.telegramPaymentChargeId === chargeId)).toHaveLength(1);
      expect(h.prisma.tables.subscription).toHaveLength(1);
      expect(h.prisma.tables.subscription[0].currentPeriodEnd.getTime()).toBe(endBefore);
      expect(h.metrics.get('payment_duplicate_total', { kind: 'update_id' })).toBe(1);
      expect(h.metrics.get('payment_duplicate_total', { kind: 'charge_id' })).toBe(2);
    });

    it('parallel identical deliveries → exactly one payment, period and entitlement set', async () => {
      const u = h.addUser();
      const inv = await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key());
      const payload = h.lastPayload();
      const a = h.successful(u, payload, 399, 'charge_parallel');
      const b = h.successful(u, payload, 399, 'charge_parallel');
      const results = await Promise.all([h.post(a), h.post(a), h.post(b)]);
      expect(results.every(r => r.httpStatus === 200)).toBe(true);
      expect(h.prisma.tables.payment.filter(p => p.status === 'PAID')).toHaveLength(1);
      expect(h.prisma.tables.subscription).toHaveLength(1);
      expect(h.prisma.tables.userEntitlement.filter(e => e.entitlement === 'ADVANCED_PROGRESS')).toHaveLength(1);
      expect(h.prisma.tables.payment[0].id).toBe(inv.paymentId);
    });

    it('buying same plan before period end extends current_period_end by exactly period_days', async () => {
      const u = h.addUser();
      await h.buy(u, 'PRO_QUARTERLY');
      const end1 = h.prisma.tables.subscription[0].currentPeriodEnd.getTime();
      await h.buy(u, 'PRO_QUARTERLY');
      expect(h.prisma.tables.subscription).toHaveLength(1);
      expect(h.prisma.tables.subscription[0].currentPeriodEnd.getTime()).toBe(end1 + 90 * DAY);
      expect((await h.subscriptions.listPayments(u.userId, {})).items).toHaveLength(2);
    });

    it('Telegram recurring renewal (same payload, new charge) creates a new payment and extends once', async () => {
      const u = h.addUser();
      const { payload } = await h.buy(u, 'PRO_MONTHLY', 'charge_first', { is_recurring: true, is_first_recurring: true, subscription_expiration_date: 1_800_000_000 });
      const sub = h.prisma.tables.subscription[0];
      expect(sub).toMatchObject({ autoRenew: true, telegramSubscriptionChargeId: 'charge_first' });
      const end1 = sub.currentPeriodEnd.getTime();
      const renewal = h.successful(u, payload, 399, 'charge_renew_1', { is_recurring: true });
      await h.post(renewal);
      await h.post({ ...renewal, update_id: h.nextUpdateId() });
      expect(h.prisma.tables.payment.filter(p => p.status === 'PAID')).toHaveLength(2);
      expect(h.prisma.tables.subscription[0].currentPeriodEnd.getTime()).toBe(end1 + 30 * DAY);
    });

    it('trainer buys TRAINER_PRO → only Trainer Pro entitlements', async () => {
      const t = h.addUser({ roles: ['TRAINER'] });
      await h.buy(t, 'TRAINER_PRO_MONTHLY');
      const me = await h.subscriptions.getMe(t);
      expect(me.effectiveTier).toBe('TRAINER_PRO');
      expect(me.entitlements).toContain('TRAINER_CLIENTS');
    });

    it('blocked user payment is recorded for manual review, access not granted', async () => {
      const u = h.addUser();
      await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key());
      const payload = h.lastPayload();
      h.prisma.tables.user.find(x => x.id === u.userId)!.status = 'BLOCKED';
      await h.post(h.successful(u, payload, 399, 'charge_blocked'));
      expect(h.prisma.tables.payment[0]).toMatchObject({ status: 'PAID', requiresManualReview: true });
      expect(h.prisma.tables.subscription).toHaveLength(0);
      expect(h.prisma.tables.auditLog.some(a => a.action === 'payment.manual_review_required')).toBe(true);
    });

    it('non-XTR currency is rejected', async () => {
      const u = h.addUser();
      await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key());
      await h.post(h.successful(u, h.lastPayload(), 399, 'charge_usd', { currency: 'USD' }));
      expect(h.prisma.tables.payment[0].status).toBe('PENDING');
      expect(h.prisma.tables.subscription).toHaveLength(0);
    });

    it('rollback when audit/outbox write fails; retry (recovery) converges without duplicates', async () => {
      const u = h.addUser();
      await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key());
      const payload = h.lastPayload();
      h.prisma.failOn = (model, op) => model === 'outboxEvent' && op === 'create';
      const res = await h.post(h.successful(u, payload, 399, 'charge_crash'));
      expect(res.httpStatus).toBe(500);
      expect(h.prisma.tables.payment[0].status).toBe('PENDING');
      expect(h.prisma.tables.subscription).toHaveLength(0);
      expect(h.prisma.tables.userEntitlement).toHaveLength(0);
      expect(h.prisma.tables.telegramWebhookEvent[0].status).toBe('FAILED');

      h.prisma.failOn = undefined;
      h.prisma.tables.telegramWebhookEvent[0].createdAt = new Date(Date.now() - 60_000);
      const rec = await h.webhooks.recoverPending();
      expect(rec.processed).toBe(1);
      await h.webhooks.recoverPending();
      expect(h.prisma.tables.payment[0].status).toBe('PAID');
      expect(h.prisma.tables.subscription).toHaveLength(1);
      expect(h.prisma.tables.telegramWebhookEvent[0].status).toBe('PROCESSED');
    });

    it('restart between webhook persistence and business processing: RECEIVED event is picked up', async () => {
      const u = h.addUser();
      await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key());
      const upd = h.successful(u, h.lastPayload(), 399, 'charge_restart');
      h.prisma.tables.telegramWebhookEvent.push({
        id: randomUUID(), updateId: BigInt(upd.update_id), eventType: 'successful_payment', payload: h.webhooks.normalize('successful_payment', upd), payloadHash: 'x'.repeat(64),
        status: 'RECEIVED', attempts: 0, errorCode: null, processedAt: null, createdAt: new Date(Date.now() - 60_000),
      });
      await h.webhooks.recoverPending();
      expect(h.prisma.tables.payment[0].status).toBe('PAID');
      // Повторная доставка того же update после восстановления — дубль.
      await h.post(upd);
      expect(h.prisma.tables.subscription).toHaveLength(1);
    });
  });

  describe('webhook security', () => {
    it('wrong secret → 404, nothing stored, logged safely', async () => {
      const u = h.addUser();
      await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key());
      const upd = h.successful(u, h.lastPayload(), 399, 'charge_evil');
      const res = await h.webhooks.handle('wrong-secret-value', undefined, upd, 100);
      expect(res.httpStatus).toBe(404);
      expect(h.prisma.tables.telegramWebhookEvent).toHaveLength(0);
      expect(h.prisma.tables.subscription).toHaveLength(0);
      expect(h.logger.records.some(r => r.includes('webhook.invalid_secret'))).toBe(true);
      expect(h.logger.records.join('')).not.toContain('wrong-secret-value');
    });

    it('rejects oversized and malformed updates', async () => {
      expect((await h.webhooks.handle(WEBHOOK_SECRET, undefined, { update_id: 1 }, 10_000_000)).httpStatus).toBe(413);
      expect((await h.webhooks.handle(WEBHOOK_SECRET, undefined, { update_id: 'x' }, 10)).httpStatus).toBe(400);
      expect((await h.webhooks.handle(WEBHOOK_SECRET, undefined, { update_id: 5, message: { successful_payment: { currency: 'XTR' } } }, 10)).httpStatus).toBe(400);
    });

    it('stored webhook payload, logs, audit and outbox contain no secrets, raw payload, PII or full charge ids', async () => {
      const u = h.addUser();
      const { payload, chargeId } = await h.buy(u, 'PRO_MONTHLY', 'stxFULLCHARGEID1234567890');
      const logs = h.logger.records.join('\n');
      const audit = JSON.stringify(h.prisma.tables.auditLog);
      const outbox = JSON.stringify(h.prisma.tables.outboxEvent);
      const events = JSON.stringify(h.prisma.tables.telegramWebhookEvent, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
      for (const blob of [logs, audit, outbox]) {
        expect(blob).not.toContain(chargeId);
        expect(blob).not.toContain(payload);
        expect(blob).not.toContain(BOT_TOKEN);
        expect(blob).not.toContain(WEBHOOK_SECRET);
      }
      expect(events).not.toContain(payload);
      expect(events).not.toContain('Ivan');
      const me = JSON.stringify(await h.subscriptions.getMe(u)) + JSON.stringify(await h.subscriptions.listPayments(u.userId, {}));
      expect(me).not.toContain(chargeId);
    });
  });

  describe('cancel auto-renew & expiration', () => {
    it('cancel → EXPIRING, access kept until period end; idempotent', async () => {
      const u = h.addUser();
      await h.buy(u, 'PRO_MONTHLY', 'charge_sub', { is_recurring: true, is_first_recurring: true, subscription_expiration_date: 1_800_000_000 });
      const k = key();
      const res = await h.subscriptions.cancelAutoRenew(u, k);
      expect(res.subscription).toMatchObject({ status: 'EXPIRING', autoRenew: false, cancelledAt: expect.any(String) });
      expect(h.telegram.edits).toEqual([{ userId: String(u.telegramId), chargeId: 'charge_sub', isCanceled: true }]);
      expect(await h.subscriptions.cancelAutoRenew(u, k)).toEqual(res);
      expect(h.telegram.edits).toHaveLength(1);
      expect((await h.subscriptions.getMe(u)).effectiveTier).toBe('PRO');
      expect(h.prisma.tables.outboxEvent.some(e => e.type === 'subscription.expiring')).toBe(true);
    });

    it('cancel without auto-renewal → 409, without subscription → 404', async () => {
      const u = h.addUser();
      await expect(h.subscriptions.cancelAutoRenew(u, key())).rejects.toMatchObject({ httpStatus: 404, code: 'ACTIVE_SUBSCRIPTION_NOT_FOUND' });
      await h.buy(u, 'PRO_QUARTERLY');
      await expect(h.subscriptions.cancelAutoRenew(u, key())).rejects.toMatchObject({ httpStatus: 409, code: 'CANCELLATION_NOT_SUPPORTED' });
    });

    it('expiration job → EXPIRED, entitlements revoked, FREE; rerun is a no-op', async () => {
      const u = h.addUser();
      await h.buy(u);
      const future = new Date(Date.now() + 31 * DAY);
      expect(await h.scheduler.expireDue(future)).toEqual({ scanned: 1, expired: 1 });
      expect(h.prisma.tables.subscription[0].status).toBe('EXPIRED');
      expect(h.prisma.tables.userEntitlement).toHaveLength(0);
      expect(h.prisma.tables.subscriptionEntitlement[0].plan).toBe('FREE');
      expect(h.prisma.tables.outboxEvent.some(e => e.type === 'subscription.expired')).toBe(true);
      expect(await h.scheduler.expireDue(future)).toEqual({ scanned: 0, expired: 0 });
      expect((await h.subscriptions.getMe(u)).effectiveTier).toBe('FREE');
    });
  });

  describe('refunds', () => {
    const admin = () => ({ userId: h.addUser({ roles: ['ADMIN'] }).userId, roles: ['ADMIN'], requestId: 'req_admin' });

    it('admin refund → REFUNDED payment & subscription, access revoked, audit', async () => {
      const u = h.addUser();
      const { invoice, chargeId } = await h.buy(u);
      const a = admin();
      const res = await h.refunds.requestRefund(a, invoice.paymentId, 'DUPLICATE_CHARGE', key());
      expect(res).toEqual({ payment: { id: invoice.paymentId, status: 'REFUNDED' } });
      expect(JSON.stringify(res)).not.toContain(chargeId);
      expect(h.telegram.refunds).toEqual([{ userId: String(u.telegramId), chargeId }]);
      expect(h.prisma.tables.payment[0].status).toBe('REFUNDED');
      expect(h.prisma.tables.subscription[0].status).toBe('REFUNDED');
      expect((await h.subscriptions.getMe(u)).effectiveTier).toBe('FREE');
      expect(h.prisma.tables.auditLog.map(x => x.action)).toEqual(expect.arrayContaining(['payment.refund.requested', 'payment.refunded']));
    });

    it('repeat refund (same or new key) does not call Telegram again', async () => {
      const u = h.addUser();
      const { invoice } = await h.buy(u);
      const a = admin();
      const k = key();
      await h.refunds.requestRefund(a, invoice.paymentId, 'DUPLICATE_CHARGE', k);
      await h.refunds.requestRefund(a, invoice.paymentId, 'DUPLICATE_CHARGE', k);
      await h.refunds.requestRefund(a, invoice.paymentId, 'DUPLICATE_CHARGE', key());
      expect(h.telegram.refunds).toHaveLength(1);
    });

    it('Telegram error keeps REFUND_PENDING (not REFUNDED); retry with same key succeeds', async () => {
      const u = h.addUser();
      const { invoice } = await h.buy(u);
      const a = admin();
      const k = key();
      h.telegram.failRefund = 'TELEGRAM_500';
      await expect(h.refunds.requestRefund(a, invoice.paymentId, 'TECHNICAL_ISSUE', k)).rejects.toMatchObject({ httpStatus: 502, code: 'REFUND_FAILED' });
      expect(h.prisma.tables.payment[0].status).toBe('REFUND_PENDING');
      expect(h.prisma.tables.refundRequest[0]).toMatchObject({ status: 'FAILED', errorCode: 'TELEGRAM_500' });
      expect((await h.subscriptions.getMe(u)).effectiveTier).toBe('PRO');
      h.telegram.failRefund = null;
      await h.refunds.requestRefund(a, invoice.paymentId, 'TECHNICAL_ISSUE', k);
      expect(h.prisma.tables.payment[0].status).toBe('REFUNDED');
      expect(h.prisma.tables.refundRequest[0].status).toBe('SUCCEEDED');
    });

    it('refund of one of two payments shortens the period, keeps access (rule 12)', async () => {
      const u = h.addUser();
      await h.buy(u, 'PRO_QUARTERLY');
      const second = await h.buy(u, 'PRO_QUARTERLY');
      const end = h.prisma.tables.subscription[0].currentPeriodEnd.getTime();
      await h.refunds.requestRefund(admin(), second.invoice.paymentId, 'USER_REQUEST', key());
      expect(h.prisma.tables.subscription[0].status).toBe('ACTIVE');
      expect(h.prisma.tables.subscription[0].currentPeriodEnd.getTime()).toBe(end - 90 * DAY);
      expect((await h.subscriptions.getMe(u)).effectiveTier).toBe('PRO');
    });

    it('non-admin cannot refund; PENDING payment not refundable', async () => {
      const u = h.addUser();
      const inv = await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key());
      await expect(h.refunds.requestRefund({ userId: u.userId, roles: ['USER'], requestId: 'r' }, inv.paymentId, 'OTHER', key())).rejects.toMatchObject({ httpStatus: 403 });
      await expect(h.refunds.requestRefund(admin(), inv.paymentId, 'OTHER', key())).rejects.toMatchObject({ httpStatus: 409, code: 'PAYMENT_NOT_REFUNDABLE' });
    });

    it('Telegram refunded_payment update finalizes refund idempotently', async () => {
      const u = h.addUser();
      const { payload, chargeId } = await h.buy(u);
      const upd = h.refunded(u, payload, 399, chargeId);
      await h.post(upd);
      await h.post({ ...upd, update_id: h.nextUpdateId() });
      expect(h.prisma.tables.payment[0].status).toBe('REFUNDED');
      expect(h.prisma.tables.outboxEvent.filter(e => e.type === 'payment.refunded')).toHaveLength(1);
    });

    it('admin read of payment history is audited', async () => {
      const u = h.addUser();
      await h.buy(u);
      const out = await h.refunds.listForAdmin(admin(), { userId: u.userId });
      expect(out.items).toHaveLength(1);
      expect(h.prisma.tables.auditLog.some(x => x.action === 'admin.payments.read')).toBe(true);
    });
  });

  describe('payments history', () => {
    it('returns only own payments with cursor pagination', async () => {
      const u = h.addUser();
      const other = h.addUser();
      for (let i = 0; i < 3; i++) {
        await h.subscriptions.createInvoice(u, { planCode: 'PRO_MONTHLY' }, key());
        h.prisma.tables.payment[h.prisma.tables.payment.length - 1].createdAt = new Date(Date.now() - i * 1000);
      }
      await h.subscriptions.createInvoice(other, { planCode: 'PRO_MONTHLY' }, key());
      const page1 = await h.subscriptions.listPayments(u.userId, { limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      const page2 = await h.subscriptions.listPayments(u.userId, { limit: 2, cursor: page1.nextCursor! });
      expect(page2.items).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
      const ids = [...page1.items, ...page2.items].map(p => p.id);
      expect(new Set(ids).size).toBe(3);
      expect(ids).not.toContain(h.prisma.tables.payment.find(p => p.userId === other.userId)!.id);
    });
  });

  describe('reconciliation', () => {
    it('repairs PAID payment without entitlements older than 5 minutes', async () => {
      const u = h.addUser();
      await h.buy(u);
      h.prisma.tables.userEntitlement = [];
      h.prisma.tables.payment[0].paidAt = new Date(Date.now() - 10 * 60_000);
      const r = await h.scheduler.reconcile();
      expect(r.mismatched).toHaveLength(1);
      expect(h.prisma.tables.userEntitlement.length).toBeGreaterThan(0);
    });
  });
});
