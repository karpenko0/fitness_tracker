import { ExerciseCatalogService } from '../../src/program/exercise-catalog.service';
import { EntitlementService } from '../../src/program/entitlement.service';

describe('ExerciseCatalogService', () => {
  const metrics = { event: jest.fn(), increment: jest.fn(), getCached: jest.fn().mockReturnValue(null), setCached: jest.fn() };
  const prisma: any = {
    exerciseCatalogItem: { findUnique: jest.fn(), findMany: jest.fn() },
    userProfile: { findUnique: jest.fn() },
    subscriptionEntitlement: { findUnique: jest.fn().mockResolvedValue({ plan: 'FREE' }) },
  };
  const service = () => new ExerciseCatalogService(prisma, new EntitlementService(prisma), metrics as any);

  it('returns a limitation warning without medical advice', async () => {
    prisma.exerciseCatalogItem.findUnique.mockResolvedValue({
      id: 'e1', title: 'Жим штанги лёжа', active: true, isSystem: true, isProOnly: false, exerciseType: 'STRENGTH',
      primaryMuscles: ['CHEST'], secondaryMuscles: [], equipmentList: ['BARBELL'], instructions: [], media: [],
      contraindications: ['SHOULDER_DISCOMFORT'], alternativeExerciseIds: [], sourceAlternatives: [{ alternative: { id: 'e2', title: 'Жим гантелей лёжа' } }], mediaItems: [],
    });
    prisma.userProfile.findUnique.mockResolvedValue({ limitationTags: ['SHOULDER_DISCOMFORT'] });
    const result = await service().get('u', 'e1');
    expect(result.warning?.code).toBe('EXERCISE_LIMITATION_WARNING');
    expect(result.warning?.message).not.toMatch(/диагноз|лечен|назнач/i);
    expect(result.alternatives).toEqual([{ id: 'e2', title: 'Жим гантелей лёжа' }]);
  });

  it('blocks inactive exercises', async () => {
    prisma.exerciseCatalogItem.findUnique.mockResolvedValue({ id: 'e1', active: false, isSystem: true, isProOnly: false });
    await expect(service().get('u', 'e1')).rejects.toMatchObject({ response: { code: 'EXERCISE_NOT_AVAILABLE' } });
  });
});
