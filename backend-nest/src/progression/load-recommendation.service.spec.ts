import { LoadRecommendationService } from './load-recommendation.service';

const sets: any[] = [{ id: 'set-1', status: 'COMPLETED', setType: 'WORKING', actualWeightKg: 80, actualReps: 10, plannedWeightKg: 80, plannedReps: 10, rpe: 7, rir: 3, skipReason: null }];

describe('LoadRecommendationService', () => {
  const recommendationStore = { upsert: jest.fn().mockResolvedValue({}) };
  const performanceStore = { findMany: jest.fn() };
  const tx = { exercisePerformance: performanceStore, exerciseProgressionRecommendation: recommendationStore, progressionAlgorithmConfig: { findUnique: jest.fn().mockResolvedValue({ increasePercent: 5, decreasePercent: 10, maxIncreasePercent: 10 }) } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('uses the preceding workout as the load baseline, not the workout being calculated', async () => {
    performanceStore.findMany.mockResolvedValue([
      { workoutId: 'current', performedAt: new Date(), maxWeightKg: 80 },
      { workoutId: 'previous', performedAt: new Date(), maxWeightKg: 75 },
    ]);

    await new LoadRecommendationService({ event: jest.fn(), increment: jest.fn() } as any).updateForExercise(tx, 'user-1', 'exercise-1', 'current', sets, 'BARBELL', 2.5);

    expect(recommendationStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ recommendedWeightKg: 77.5, confidence: 'MEDIUM', reasonCode: 'PROGRESSIVE_OVERLOAD', basedOnWorkoutId: 'current' }),
    }));
  });

  it('uses planned weight and low confidence when only stale history exists', async () => {
    performanceStore.findMany.mockResolvedValue([{ workoutId: 'old', performedAt: new Date(Date.now() - 91 * 86_400_000), maxWeightKg: 70 }]);

    await new LoadRecommendationService({ event: jest.fn(), increment: jest.fn() } as any).updateForExercise(tx, 'user-1', 'exercise-1', 'current', sets, 'BARBELL', 2.5);

    expect(recommendationStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ confidence: 'LOW' }),
    }));
  });

  it('uses the planned weight when history is absent', async () => {
    performanceStore.findMany.mockResolvedValue([]);

    await new LoadRecommendationService({ event: jest.fn(), increment: jest.fn() } as any).updateForExercise(tx, 'user-1', 'exercise-1', 'current', sets, 'BARBELL', 2.5);

    expect(recommendationStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ recommendedWeightKg: 80, confidence: 'NONE', reasonCode: 'PLAN_VALUE' }),
    }));
  });
});
