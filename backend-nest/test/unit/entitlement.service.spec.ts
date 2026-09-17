import { EntitlementService } from '../../src/program/entitlement.service';

describe('EntitlementService', () => {
  it('blocks Free users from Pro content', async () => {
    const prisma: any = { subscriptionEntitlement: { findUnique: jest.fn().mockResolvedValue({ plan: 'FREE' }) } };
    await expect(new EntitlementService(prisma).assertPro('u')).rejects.toMatchObject({ response: { code: 'PRO_FEATURE_REQUIRED' } });
  });

  it('keeps existing data after Pro expiry by applying Free limits only to new creates', async () => {
    const prisma: any = {
      subscriptionEntitlement: { findUnique: jest.fn().mockResolvedValue({ plan: 'FREE', maxDraftCustomPrograms: 2, maxActiveCustomPrograms: 1, maxCustomExercises: 10 }) },
      starterProgram: { count: jest.fn().mockResolvedValue(2) },
    };
    await expect(new EntitlementService(prisma).assertCanCreateCustomProgram('u')).rejects.toMatchObject({ response: { code: 'PLAN_LIMIT_EXCEEDED' } });
  });
});
