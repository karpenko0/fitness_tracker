import { Inject, Injectable } from '@nestjs/common';
import { FREE_LIMITS, PRO_LIMITS } from '../program/program.constants';
import { ACCESS_STATUSES, Entitlement, PRODUCT_SCOPE, Tier } from './subscription.catalog';
import { effectiveTier, entitlementsForTier, paywallEligibility, SubscriptionError } from './subscription.domain';
import { SubscriptionLogger, SubscriptionMetrics } from './subscription.observability';
import { Db, PRISMA } from './subscription.prisma';

export interface AccessState {
  tier: Tier;
  entitlements: Entitlement[];
  subscription: any | null;
}

/** Серверный источник прав. Tier из JWT не используется. */
@Injectable()
export class EntitlementsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Db,
    private readonly metrics: SubscriptionMetrics,
    private readonly logger: SubscriptionLogger,
  ) {}

  async findAccessSubscription(userId: string, db: Db = this.prisma) {
    return db.subscription.findFirst({
      where: { userId, productScope: PRODUCT_SCOPE, status: { in: ACCESS_STATUSES } },
      include: { plan: true },
    });
  }

  async getAccess(userId: string, now = new Date(), db: Db = this.prisma): Promise<AccessState> {
    const subscription = await this.findAccessSubscription(userId, db);
    const tier = effectiveTier(subscription, now);
    return { tier, entitlements: entitlementsForTier(tier), subscription };
  }

  async paywall(userId: string, db: Db = this.prisma) {
    const [profile, started, completed] = await Promise.all([
      db.userProfile.findUnique({ where: { userId }, select: { onboardingCompleted: true } }),
      db.workout.count({ where: { userId, startedAt: { not: null } } }),
      db.workout.count({ where: { userId, status: 'COMPLETED' } }),
    ]);
    return paywallEligibility({ onboardingCompleted: !!profile?.onboardingCompleted, hasStartedWorkout: started > 0, hasCompletedWorkout: completed > 0 });
  }

  /** Бросает 403 ENTITLEMENT_REQUIRED с безопасным paywallContext. */
  async assert(userId: string, entitlement: Entitlement, requestId?: string) {
    const access = await this.getAccess(userId);
    if (access.entitlements.includes(entitlement)) return access;
    const paywallContext = await this.paywall(userId);
    this.metrics.inc('entitlement_denied_total', { entitlement, current_tier: access.tier });
    this.logger.log('security.entitlement_denied', { requestId, userId, entitlement, currentTier: access.tier }, 'warn');
    throw new SubscriptionError(403, 'ENTITLEMENT_REQUIRED', 'Для этой функции требуется тариф Pro.', {
      currentPlan: access.tier,
      requiredEntitlement: entitlement,
      paywallContext,
    });
  }

  /**
   * Транзакционный пересчёт материализованных прав (user_entitlements) и legacy-лимитов
   * (subscription_entitlements) по актуальной подписке. Вызывается внутри той же транзакции,
   * что и изменение подписки.
   */
  async recompute(tx: Db, userId: string, now = new Date()): Promise<AccessState> {
    const access = await this.getAccess(userId, now, tx);
    await tx.userEntitlement.deleteMany({ where: { userId } });
    if (access.tier !== 'FREE' && access.subscription) {
      for (const entitlement of access.entitlements) {
        await tx.userEntitlement.create({ data: { userId, entitlement, subscriptionId: access.subscription.id, grantedAt: now, expiresAt: access.subscription.currentPeriodEnd } });
      }
    }
    const legacy = access.tier === 'FREE' ? { plan: 'FREE', ...FREE_LIMITS, extendedStats: false } : { plan: 'PRO', ...PRO_LIMITS, extendedStats: true };
    await tx.subscriptionEntitlement.upsert({ where: { userId }, create: { userId, ...legacy }, update: legacy });
    return access;
  }
}
