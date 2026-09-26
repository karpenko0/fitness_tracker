import { HttpException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import {
  ACCESS_STATUSES, MAX_STARS, MIN_STARS, PaidTier, PaymentStatus, STARS_CURRENCY, SubscriptionStatus, Tier, TIER_ENTITLEMENTS,
  Entitlement, ValueMilestone,
} from './subscription.catalog';

/** Доменная ошибка: транслируется контроллерами/фильтром в HTTP { error: { code } }. */
export class SubscriptionError extends HttpException {
  constructor(public readonly httpStatus: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super({ code, message, details }, httpStatus);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === 'string' && key.length >= 16 && key.length <= 128 && /^[A-Za-z0-9_\-:.]+$/.test(key);
}

export function assertIdempotencyKey(key: unknown): string {
  if (key === undefined || key === null || key === '') throw new SubscriptionError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  if (!isValidIdempotencyKey(key)) throw new SubscriptionError(400, 'VALIDATION_ERROR', 'Idempotency-Key must be 16-128 safe characters', { field: 'Idempotency-Key' });
  return key;
}

export function isValidStarsAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isInteger(amount) && amount >= MIN_STARS && amount <= MAX_STARS;
}

export function isValidPlanCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code);
}

/** Продление/активация периода в UTC. Покупка того же плана до окончания — продлевает от current_period_end. */
export function computePeriod(now: Date, periodDays: number, currentEnd?: Date | null): { start: Date; end: Date } {
  if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 366) throw new SubscriptionError(500, 'INVALID_PLAN', 'Invalid plan period');
  const base = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
  return { start: currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now, end: new Date(base.getTime() + periodDays * DAY_MS) };
}

const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  ACTIVE: ['ACTIVE', 'EXPIRING', 'EXPIRED', 'REFUNDED', 'CANCELLED'],
  EXPIRING: ['EXPIRING', 'ACTIVE', 'EXPIRED', 'REFUNDED'],
  CANCELLED: [],
  EXPIRED: [],
  REFUNDED: [],
};

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['PAID', 'FAILED', 'CANCELLED'],
  PAID: ['REFUND_PENDING', 'REFUNDED'],
  REFUND_PENDING: ['REFUNDED', 'PAID'],
  REFUNDED: [],
  FAILED: ['PAID'], // успешная оплата после истечения invoice не теряется
  CANCELLED: ['PAID'],
};

export function canTransitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return SUBSCRIPTION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus) {
  if (!canTransitionPayment(from, to)) throw new SubscriptionError(409, 'INVALID_PAYMENT_STATE', `Payment cannot move from ${from} to ${to}`);
}

export function hasAccess(sub: { status: string; currentPeriodEnd: Date | null } | null | undefined, now: Date): boolean {
  return !!sub && ACCESS_STATUSES.includes(sub.status as SubscriptionStatus) && !!sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now.getTime();
}

export function effectiveTier(sub: { status: string; currentPeriodEnd: Date | null; tier?: string | null } | null | undefined, now: Date): Tier {
  return hasAccess(sub, now) ? ((sub!.tier as PaidTier) ?? 'PRO') : 'FREE';
}

export function entitlementsForTier(tier: Tier): Entitlement[] {
  return [...TIER_ENTITLEMENTS[tier]];
}

export interface PaywallFacts {
  onboardingCompleted: boolean;
  hasStartedWorkout: boolean;
  hasCompletedWorkout: boolean;
  viewedProResult?: boolean;
}

/** US-010-01: paywall только после достижения value milestone. */
export function paywallEligibility(f: PaywallFacts): { isEligible: boolean; valueMilestone: ValueMilestone | null } {
  if (f.hasCompletedWorkout) return { isEligible: true, valueMilestone: 'FIRST_WORKOUT_COMPLETED' };
  if (f.onboardingCompleted && f.hasStartedWorkout) return { isEligible: true, valueMilestone: 'FIRST_WORKOUT_STARTED' };
  if (f.onboardingCompleted && f.viewedProResult) return { isEligible: true, valueMilestone: 'PRO_RESULT_VIEWED' };
  return { isEligible: false, valueMilestone: null };
}

export function isTrainer(roles: string[]): boolean {
  return roles.includes('TRAINER');
}

export function planVisibleForRoles(tier: string, roles: string[]): boolean {
  return tier === 'PRO' || (tier === 'TRAINER_PRO' && isTrainer(roles));
}

/** RBAC покупки + правило «без смены тарифа с перерасчётом». */
export function assertCanPurchase(input: { planTier: string; roles: string[]; currentAccessTier: Tier }) {
  if (input.planTier === 'TRAINER_PRO' && !isTrainer(input.roles)) throw new SubscriptionError(403, 'TRAINER_ROLE_REQUIRED', 'Trainer Pro requires the TRAINER role');
  if (input.currentAccessTier !== 'FREE' && input.currentAccessTier !== input.planTier) {
    throw new SubscriptionError(422, 'PLAN_CHANGE_NOT_SUPPORTED', 'Switching between PRO and TRAINER_PRO is not supported');
  }
}

export interface PreCheckoutQuery {
  id: string;
  from: { id: number | string };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export interface ExpectedPayment {
  status: string;
  amountStars: number;
  currency: string;
  userTelegramId: bigint | number | string;
  expiresAt: Date;
  userActive: boolean;
}

/** Сверка pre-checkout (§5.2 п.7). Возвращает причину отказа или null. */
export function verifyPreCheckout(q: PreCheckoutQuery, p: ExpectedPayment | null, now: Date): string | null {
  if (!p) return 'PAYLOAD_NOT_FOUND';
  if (q.currency !== STARS_CURRENCY || p.currency !== STARS_CURRENCY) return 'CURRENCY_MISMATCH';
  if (!Number.isInteger(q.total_amount) || q.total_amount !== p.amountStars) return 'AMOUNT_MISMATCH';
  if (String(q.from?.id) !== String(p.userTelegramId)) return 'USER_MISMATCH';
  if (p.status !== 'PENDING') return 'INVALID_STATUS';
  if (p.expiresAt.getTime() <= now.getTime()) return 'INVOICE_EXPIRED';
  if (!p.userActive) return 'ACCOUNT_INACTIVE';
  return null;
}

export function generateInvoicePayload(): string {
  // 24 байта → 32 символа base64url, укладывается в лимит Telegram 1-128 байт; не содержит данных.
  return `ft1_${randomBytes(24).toString('base64url')}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableHash(value: unknown): string {
  return sha256(JSON.stringify(sortKeys(value)));
}

function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
  return v;
}

export function maskId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.length <= 8) return '****';
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

const SECRET_KEY_PATTERN = /(token|secret|initdata|authorization|charge_id|chargeid|invoice_payload|invoicepayload|password|phone|email|order_info|shipping)/i;

/** Redaction для логов, аудита и сохранения raw webhook. */
export function redactFinancial(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map(v => redactFinancial(v, depth + 1));
  if (typeof value === 'bigint') return value.toString();
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => {
    if (SECRET_KEY_PATTERN.test(k)) return [k, typeof v === 'string' ? maskId(v) : '[REDACTED]'];
    if (['first_name', 'last_name', 'username'].includes(k)) return [k, '[REDACTED]'];
    return [k, redactFinancial(v, depth + 1)];
  }));
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const [iso, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || typeof id !== 'string') throw new Error('bad');
    return { createdAt, id };
  } catch {
    throw new SubscriptionError(400, 'VALIDATION_ERROR', 'Invalid cursor', { field: 'cursor' });
  }
}
