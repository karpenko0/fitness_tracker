import { StarterProgramRecommendationService } from '../../src/onboarding/starter-program-recommendation.service';

describe('StarterProgramRecommendationService', () => {
  const exact = { id: 'exact', title: 'Exact', goals: ['WEIGHT_LOSS'], levels: ['BEGINNER'], locations: ['HOME'], workoutsPerWeek: 3, durationMinutes: 30, requiredEquipment: ['DUMBBELLS'], isFallback: false };
  const fallback = { id: 'fallback', title: 'Fallback', isFallback: true };
  const prisma: any = { starterProgram: { findMany: jest.fn(), findFirst: jest.fn() } };
  const service = new StarterProgramRecommendationService(prisma);
  const data = { fitnessGoal: 'WEIGHT_LOSS', experienceLevel: 'BEGINNER', trainingLocation: 'HOME', trainingFrequency: 3, preferredWorkoutDuration: 30, equipment: ['DUMBBELLS'] };

  beforeEach(() => jest.clearAllMocks());
  it('selects the exact compatible published program', async () => {
    prisma.starterProgram.findMany.mockResolvedValue([exact]);
    await expect(service.recommend(data)).resolves.toEqual({ program: exact, fallback: false });
  });
  it('uses the published fallback when no compatible program exists', async () => {
    prisma.starterProgram.findMany.mockResolvedValue([]);
    prisma.starterProgram.findFirst.mockResolvedValue(fallback);
    await expect(service.recommend(data)).resolves.toEqual({ program: fallback, fallback: true });
  });

  it('does not use fallback when it is disabled', async () => {
    prisma.starterProgram.findMany.mockResolvedValue([]);
    const config = { get: jest.fn().mockReturnValue('false') };
    const configuredService = new StarterProgramRecommendationService(prisma, config as any);
    await expect(configuredService.recommend(data)).rejects.toMatchObject({ response: { code: 'STARTER_PROGRAM_NOT_FOUND' } });
    expect(prisma.starterProgram.findFirst).not.toHaveBeenCalled();
  });
});
