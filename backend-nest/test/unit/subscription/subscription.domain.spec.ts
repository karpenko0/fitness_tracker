import {
  assertCanPurchase, assertIdempotencyKey, canTransitionPayment, canTransitionSubscription, computePeriod, decodeCursor, effectiveTier, encodeCursor,
  generateInvoicePayload, isValidPlanCode, isValidStarsAmount, maskId, paywallEligibility, planVisibleForRoles, redactFinancial, verifyPreCheckout,
} from '../../../src/subscription/subscription.domain';

describe('SPEC-010 domain rules', () => {
  describe('validation', () => {
    it('validates Stars amount as integer 1..2 500 000', () => {
      expect(isValidStarsAmount(1)).toBe(true);
      expect(isValidStarsAmount(2_500_000)).toBe(true);
      expect(isValidStarsAmount(0)).toBe(false);
      expect(isValidStarsAmount(2_500_001)).toBe(false);
      expect(isValidStarsAmount(9.5)).toBe(false);
      expect(isValidStarsAmount('399')).toBe(false);
    });

    it('validates planCode', () => {
      expect(isValidPlanCode('PRO_MONTHLY')).toBe(true);
      expect(isValidPlanCode('pro')).toBe(false);
      expect(isValidPlanCode('PRO; DROP')).toBe(false);
    });

    it('requires Idempotency-Key 16..128', () => {
      expect(() => assertIdempotencyKey(undefined)).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED' }));
      expect(() => assertIdempotencyKey('short')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
      expect(() => assertIdempotencyKey('x'.repeat(129))).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
      expect(assertIdempotencyKey('5d745c5e-7d9d-41c9-8b00-1c2de2d0fb22')).toBe('5d745c5e-7d9d-41c9-8b00-1c2de2d0fb22');
    });
  });

  describe('period calculation in UTC', () => {
    const now = new Date('2026-09-26T12:00:00.000Z');
    it('activates 30 and 90 days from now', () => {
      expect(computePeriod(now, 30).end.toISOString()).toBe('2026-10-26T12:00:00.000Z');
      expect(computePeriod(now, 90).end.toISOString()).toBe('2026-12-25T12:00:00.000Z');
    });
    it('extends exactly period_days from current end (DST-agnostic)', () => {
      const end = new Date('2026-10-20T00:00:00.000Z');
      expect(computePeriod(now, 30, end).end.toISOString()).toBe('2026-11-19T00:00:00.000Z');
    });
    it('ignores a past end', () => {
      expect(computePeriod(now, 30, new Date('2026-01-01T00:00:00Z')).end.toISOString()).toBe('2026-10-26T12:00:00.000Z');
    });
  });

  describe('state machines', () => {
    it('ACTIVE → EXPIRING → EXPIRED', () => {
      expect(canTransitionSubscription('ACTIVE', 'EXPIRING')).toBe(true);
      expect(canTransitionSubscription('EXPIRING', 'EXPIRED')).toBe(true);
      expect(canTransitionSubscription('EXPIRED', 'ACTIVE')).toBe(false);
      expect(canTransitionSubscription('REFUNDED', 'ACTIVE')).toBe(false);
    });
    it('PAID → REFUND_PENDING → REFUNDED, no double refund', () => {
      expect(canTransitionPayment('PENDING', 'PAID')).toBe(true);
      expect(canTransitionPayment('PAID', 'REFUND_PENDING')).toBe(true);
      expect(canTransitionPayment('REFUND_PENDING', 'REFUNDED')).toBe(true);
      expect(canTransitionPayment('REFUNDED', 'REFUND_PENDING')).toBe(false);
      expect(canTransitionPayment('PENDING', 'REFUNDED')).toBe(false);
    });
    it('FREE is computed fallback', () => {
      const now = new Date();
      expect(effectiveTier(null, now)).toBe('FREE');
      expect(effectiveTier({ status: 'EXPIRING', currentPeriodEnd: new Date(now.getTime() + 1000), tier: 'PRO' }, now)).toBe('PRO');
      expect(effectiveTier({ status: 'ACTIVE', currentPeriodEnd: new Date(now.getTime() - 1000), tier: 'PRO' }, now)).toBe('FREE');
      expect(effectiveTier({ status: 'CANCELLED', currentPeriodEnd: new Date(now.getTime() + 1000), tier: 'PRO' }, now)).toBe('FREE');
    });
  });

  describe('paywall eligibility', () => {
    it('is not eligible before value milestone', () => {
      expect(paywallEligibility({ onboardingCompleted: false, hasStartedWorkout: false, hasCompletedWorkout: false })).toEqual({ isEligible: false, valueMilestone: null });
      expect(paywallEligibility({ onboardingCompleted: true, hasStartedWorkout: false, hasCompletedWorkout: false }).isEligible).toBe(false);
      expect(paywallEligibility({ onboardingCompleted: false, hasStartedWorkout: true, hasCompletedWorkout: false }).isEligible).toBe(false);
    });
    it('eligible after onboarding + first workout started or a completed workout', () => {
      expect(paywallEligibility({ onboardingCompleted: true, hasStartedWorkout: true, hasCompletedWorkout: false }).valueMilestone).toBe('FIRST_WORKOUT_STARTED');
      expect(paywallEligibility({ onboardingCompleted: false, hasStartedWorkout: true, hasCompletedWorkout: true }).valueMilestone).toBe('FIRST_WORKOUT_COMPLETED');
    });
  });

  describe('RBAC', () => {
    it('TRAINER_PRO requires TRAINER role', () => {
      expect(() => assertCanPurchase({ planTier: 'TRAINER_PRO', roles: ['USER'], currentAccessTier: 'FREE' })).toThrow(expect.objectContaining({ code: 'TRAINER_ROLE_REQUIRED' }));
      expect(() => assertCanPurchase({ planTier: 'TRAINER_PRO', roles: ['TRAINER'], currentAccessTier: 'FREE' })).not.toThrow();
      expect(planVisibleForRoles('TRAINER_PRO', ['USER'])).toBe(false);
      expect(planVisibleForRoles('PRO', ['USER'])).toBe(true);
    });
    it('PRO ↔ TRAINER_PRO change is not supported', () => {
      expect(() => assertCanPurchase({ planTier: 'TRAINER_PRO', roles: ['TRAINER'], currentAccessTier: 'PRO' })).toThrow(expect.objectContaining({ code: 'PLAN_CHANGE_NOT_SUPPORTED' }));
      expect(() => assertCanPurchase({ planTier: 'PRO', roles: [], currentAccessTier: 'PRO' })).not.toThrow();
    });
  });

  describe('pre-checkout verification', () => {
    const now = new Date('2026-09-26T12:00:00Z');
    const expected = { status: 'PENDING', amountStars: 399, currency: 'XTR', userTelegramId: 42n, expiresAt: new Date('2026-09-26T12:30:00Z'), userActive: true };
    const q = { id: 'q', from: { id: 42 }, currency: 'XTR', total_amount: 399, invoice_payload: 'p' };
    it('accepts a matching query', () => expect(verifyPreCheckout(q, expected, now)).toBeNull());
    it.each([
      [{ ...q, currency: 'USD' }, expected, 'CURRENCY_MISMATCH'],
      [{ ...q, total_amount: 1 }, expected, 'AMOUNT_MISMATCH'],
      [{ ...q, from: { id: 7 } }, expected, 'USER_MISMATCH'],
      [q, { ...expected, status: 'PAID' }, 'INVALID_STATUS'],
      [q, { ...expected, expiresAt: now }, 'INVOICE_EXPIRED'],
      [q, { ...expected, userActive: false }, 'ACCOUNT_INACTIVE'],
      [q, null, 'PAYLOAD_NOT_FOUND'],
    ])('rejects %#', (query, payment, reason) => expect(verifyPreCheckout(query as any, payment as any, now)).toBe(reason));
  });

  describe('safe serialization', () => {
    it('payload is opaque, random and within Telegram limit', () => {
      const a = generateInvoicePayload();
      expect(a.length).toBeLessThanOrEqual(128);
      expect(a).not.toBe(generateInvoicePayload());
    });
    it('masks charge ids and redacts secrets/PII', () => {
      expect(maskId('stxABCDEFGHIJKLMN')).toBe('stxA…KLMN');
      const out = JSON.stringify(redactFinancial({ telegram_payment_charge_id: 'stxABCDEFGHIJKLMN', botToken: '123:abc', initData: 'q=1', nested: { invoice_payload: 'ft1_secretpayloadvalue', first_name: 'Ivan' }, amount: 5 }));
      expect(out).not.toContain('stxABCDEFGHIJKLMN');
      expect(out).not.toContain('123:abc');
      expect(out).not.toContain('ft1_secretpayloadvalue');
      expect(out).not.toContain('Ivan');
      expect(out).toContain('"amount":5');
    });
    it('cursor round-trips and rejects garbage', () => {
      const d = new Date('2026-09-26T12:00:00Z');
      expect(decodeCursor(encodeCursor(d, 'abc'))).toEqual({ createdAt: d, id: 'abc' });
      expect(() => decodeCursor('###')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });
  });
});
