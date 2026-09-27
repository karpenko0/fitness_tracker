import { ACCESS_STATUSES, Entitlement, PRODUCT_SCOPE, Tier } from './subscription.catalog';
import { effectiveTier, entitlementsForTier, paywallEligibility, SubscriptionError } from './subscription.domain';

/**
 * Общие серверные проверки доступа для всех модулей (SPEC-010 §9).
 * Источник истины — таблица subscriptions; legacy `SubscriptionEntitlement` — только зеркало лимитов.
 * Fallback на legacy-таблицу используется, лишь если клиент БД не знает модель subscription
 * (старые unit-тесты с частичными моками).
 */
export async function resolveAccess(db: any, userId: string, now = new Date()): Promise<{ tier: Tier; entitlements: Entitlement[] }> {
  let tier: Tier = 'FREE';
  if (db?.subscription?.findFirst) {
    const sub = await db.subscription.findFirst({ where: { userId, productScope: PRODUCT_SCOPE, status: { in: ACCESS_STATUSES } } });
    tier = effectiveTier(sub, now);
  } else if (db?.subscriptionEntitlement?.findUnique) {
    const legacy = await db.subscriptionEntitlement.findUnique({ where: { userId } });
    tier = legacy?.plan === 'PRO' || legacy?.plan === 'TRAINER_PRO' ? legacy.plan : 'FREE';
  }
  return { tier, entitlements: entitlementsForTier(tier) };
}

/** true для PRO и TRAINER_PRO. */
export async function hasPaidAccess(db: any, userId: string): Promise<boolean> {
  return (await resolveAccess(db, userId)).tier !== 'FREE';
}

export async function paywallFor(db: any, userId: string) {
  try {
    if (!db?.userProfile?.findUnique || !db?.workout?.count) return { isEligible: false, valueMilestone: null };
    const [profile, started, completed] = await Promise.all([
      db.userProfile.findUnique({ where: { userId }, select: { onboardingCompleted: true } }),
      db.workout.count({ where: { userId, startedAt: { not: null } } }),
      db.workout.count({ where: { userId, status: 'COMPLETED' } }),
    ]);
    return paywallEligibility({ onboardingCompleted: !!profile?.onboardingCompleted, hasStartedWorkout: started > 0, hasCompletedWorkout: completed > 0 });
  } catch {
    return { isEligible: false, valueMilestone: null };
  }
}

/** 403 ENTITLEMENT_REQUIRED в формате §7.2 с безопасным paywallContext. */
export async function entitlementRequired(db: any, userId: string, entitlement: Entitlement, extra: Record<string, unknown> = {}) {
  const [{ tier }, paywallContext] = await Promise.all([resolveAccess(db, userId), paywallFor(db, userId)]);
  return new SubscriptionError(403, 'ENTITLEMENT_REQUIRED', 'Для этой функции требуется тариф Pro.', {
    currentPlan: tier,
    requiredEntitlement: entitlement,
    paywallContext,
    ...extra,
  });
}
