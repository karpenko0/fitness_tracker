import { randomUUID } from 'crypto';
import { EntitlementService } from '../../../src/program/entitlement.service';
import { entitlementRequired, hasPaidAccess, resolveAccess } from '../../../src/subscription/access';
import { buildHarness } from './harness';

describe('SPEC-010 shared access checks used by other modules', () => {
  it('subscription is the source of truth for legacy EntitlementService and hasPaidAccess', async () => {
    const h = buildHarness();
    const u = h.addUser();
    const legacy = new EntitlementService(h.prisma as any);
    // Legacy-строка «PRO» без подписки не даёт доступ.
    h.prisma.tables.subscriptionEntitlement.push({ id: randomUUID(), userId: u.userId, plan: 'PRO' });
    expect((await legacy.get(u.userId)).plan).toBe('FREE');
    expect(await hasPaidAccess(h.prisma, u.userId)).toBe(false);

    await h.buy(u);
    expect((await legacy.get(u.userId)).plan).toBe('PRO');
    expect((await legacy.get(u.userId)).maxActiveCustomPrograms).toBeGreaterThan(1);
    expect(await hasPaidAccess(h.prisma, u.userId)).toBe(true);

    await h.scheduler.expireDue(new Date(Date.now() + 40 * 86_400_000));
    expect(await hasPaidAccess(h.prisma, u.userId)).toBe(false);
  });

  it('TRAINER_PRO counts as paid for Pro content', async () => {
    const h = buildHarness();
    const t = h.addUser({ roles: ['TRAINER'] });
    await h.buy(t, 'TRAINER_PRO_MONTHLY');
    expect((await resolveAccess(h.prisma, t.userId)).tier).toBe('TRAINER_PRO');
    expect((await new EntitlementService(h.prisma as any).get(t.userId)).plan).toBe('PRO');
  });

  it('entitlementRequired builds §7.2 error with paywallContext', async () => {
    const h = buildHarness();
    const u = h.addUser();
    h.prisma.tables.workout.push({ id: randomUUID(), userId: u.userId, status: 'COMPLETED', startedAt: new Date() });
    const err = await entitlementRequired(h.prisma, u.userId, 'PROGRESS_PHOTOS_UNLIMITED', { limit: 5 });
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toMatchObject({
      code: 'ENTITLEMENT_REQUIRED',
      details: { currentPlan: 'FREE', requiredEntitlement: 'PROGRESS_PHOTOS_UNLIMITED', limit: 5, paywallContext: { isEligible: true, valueMilestone: 'FIRST_WORKOUT_COMPLETED' } },
    });
  });

  it('legacy EntitlementService.assertPro throws ENTITLEMENT_REQUIRED', async () => {
    const h = buildHarness();
    const u = h.addUser();
    await expect(new EntitlementService(h.prisma as any).assertPro(u.userId)).rejects.toMatchObject({ code: 'ENTITLEMENT_REQUIRED' });
  });
});
