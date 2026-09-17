import { ProgramMatchingService } from '../../src/program/program-matching.service';

describe('ProgramMatchingService', () => {
  const exact = { id: 'exact', title: 'Exact', goal: 'WEIGHT_LOSS', level: 'BEGINNER', location: 'HOME', goals: ['WEIGHT_LOSS'], levels: ['BEGINNER'], locations: ['HOME'], workoutsPerWeek: 3, durationMinutes: 30, estimatedWorkoutDurationMinutes: 30, requiredEquipment: ['DUMBBELLS'], contraindications: [], workouts: [], isFallback: false };
  const close = { ...exact, id: 'close', estimatedWorkoutDurationMinutes: 15, durationMinutes: 15 };
  const fallback = { id: 'fallback', title: 'Fallback', isFallback: true, status: 'PUBLISHED', active: true, requiredEquipment: ['BODYWEIGHT'], contraindications: [], workouts: [] };
  const conflicting = { ...exact, id: 'bad', workouts: [{ exercises: [{ exercise: { contraindications: ['SHOULDER_DISCOMFORT'] } }] }] };
  const prisma: any = { starterProgram: { findMany: jest.fn(), findFirst: jest.fn() } };
  const data = { fitnessGoal: 'WEIGHT_LOSS', experienceLevel: 'BEGINNER', trainingLocation: 'HOME', trainingFrequency: 3, preferredWorkoutDuration: 30, equipment: ['DUMBBELLS'] };

  beforeEach(() => jest.clearAllMocks());

  it('selects the exact compatible published program', async () => {
    prisma.starterProgram.findMany.mockResolvedValue([exact]);
    await expect(new ProgramMatchingService(prisma).recommend(data)).resolves.toEqual({ program: exact, fallback: false, matchType: 'exact' });
  });

  it('prefers nearest lesser duration when exact match is missing', async () => {
    prisma.starterProgram.findMany.mockResolvedValue([close]);
    await expect(new ProgramMatchingService(prisma).recommend(data)).resolves.toMatchObject({ program: close, matchType: 'nearest_duration' });
  });

  it('skips programs with conflicting structured limitations', async () => {
    prisma.starterProgram.findMany.mockResolvedValue([conflicting]);
    prisma.starterProgram.findFirst.mockResolvedValue(fallback);
    await expect(new ProgramMatchingService(prisma).recommend({ ...data, limitationTags: ['SHOULDER_DISCOMFORT'] })).resolves.toMatchObject({ program: fallback, matchType: 'fallback' });
  });

  it('does not use fallback when it is disabled', async () => {
    prisma.starterProgram.findMany.mockResolvedValue([]);
    const config = { get: jest.fn().mockReturnValue('false') };
    await expect(new ProgramMatchingService(prisma, config as any).recommend(data)).rejects.toMatchObject({ response: { code: 'STARTER_PROGRAM_NOT_FOUND' } });
    expect(prisma.starterProgram.findFirst).not.toHaveBeenCalled();
  });
});
