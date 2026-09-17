import { createHash } from 'crypto';
import { ProgramService } from '../../src/program/program.service';
import { EntitlementService } from '../../src/program/entitlement.service';
import { ProgramRepository } from '../../src/program/program.repository';
import { FREE_LIMITS } from '../../src/program/program.constants';

describe('ProgramService', () => {
  const metrics = { event: jest.fn(), increment: jest.fn(), observe: jest.fn(), getCached: jest.fn().mockReturnValue(null), setCached: jest.fn(), invalidate: jest.fn() };
  const catalog = { assertUsable: jest.fn().mockResolvedValue({ id: 'e1', active: true, isSystem: true, isProOnly: false, exerciseType: 'STRENGTH' }) };
  const prisma: any = {
    starterProgram: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), count: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    userProgramAssignment: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    programWorkout: { aggregate: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), delete: jest.fn() },
    programWorkoutExercise: { aggregate: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    programExerciseSet: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    idempotencyKey: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    auditLog: { create: jest.fn(), createMany: jest.fn() },
    workout: { create: jest.fn(), findFirst: jest.fn() },
    workoutExercise: { create: jest.fn() },
    workoutSet: { create: jest.fn() },
    subscriptionEntitlement: { findUnique: jest.fn().mockResolvedValue(null) },
    exerciseCatalogItem: { findUnique: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    $executeRaw: jest.fn(),
  };

  const service = () => new ProgramService(prisma, new ProgramRepository(prisma), new EntitlementService(prisma), catalog as any, metrics as any);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.subscriptionEntitlement.findUnique.mockResolvedValue(null);
    prisma.starterProgram.findUnique.mockImplementation((args: any) => { if (args?.where?.id) return Promise.resolve({ id: args.where.id, ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] }); return Promise.resolve(null); });
  });

  it('requires an idempotency key for writes', async () => {
    await expect(service().create('u', { title: 'Моя программа', goal: 'MUSCLE_GAIN', level: 'BEGINNER', location: 'GYM', durationWeeks: 8, workoutsPerWeek: 4, estimatedWorkoutDurationMinutes: 60 } as any)).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
  });

  it('enforces Free draft limits', async () => {
    prisma.starterProgram.count.mockResolvedValue(FREE_LIMITS.maxDraftCustomPrograms);
    await expect(service().create('u', { title: 'Моя программа', goal: 'MUSCLE_GAIN', level: 'BEGINNER', location: 'GYM', durationWeeks: 8, workoutsPerWeek: 4, estimatedWorkoutDurationMinutes: 60 } as any, 'key')).rejects.toMatchObject({ response: { code: 'PLAN_LIMIT_EXCEEDED' } });
  });

  it('returns an idempotent create response without duplicating', async () => {
    const body = { id: 'p1' };
    prisma.idempotencyKey.findUnique.mockResolvedValue({ requestHash: createHash('sha256').update(JSON.stringify({ title: 'Моя программа', goal: 'MUSCLE_GAIN', level: 'BEGINNER', location: 'GYM', durationWeeks: 8, workoutsPerWeek: 4, estimatedWorkoutDurationMinutes: 60 })).digest('hex'), responseBody: body });
    await expect(service().create('u', { title: 'Моя программа', goal: 'MUSCLE_GAIN', level: 'BEGINNER', location: 'GYM', durationWeeks: 8, workoutsPerWeek: 4, estimatedWorkoutDurationMinutes: 60 } as any, 'key')).resolves.toBe(body);
    expect(prisma.starterProgram.create).not.toHaveBeenCalled();
  });

  it('rejects idempotency-key reuse with a different body', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue({ requestHash: 'other', responseBody: {} });
    await expect(service().create('u', { title: 'Моя программа', goal: 'MUSCLE_GAIN', level: 'BEGINNER', location: 'GYM', durationWeeks: 8, workoutsPerWeek: 4, estimatedWorkoutDurationMinutes: 60 } as any, 'key')).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('rejects stale program versions', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 4, workouts: [] });
    await expect(service().update('u', 'p1', { version: 3, title: 'Новое имя' } as any, 'key')).rejects.toMatchObject({ response: { code: 'PROGRAM_VERSION_CONFLICT' } });
  });

  it('forbids editing a system program', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: null, type: 'SYSTEM', status: 'PUBLISHED', version: 1, workouts: [] });
    await expect(service().update('u', 'p1', { version: 1, title: 'Hack' } as any, 'key')).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
  });

  it('hides Pro programs from Free catalog listing', async () => {
    prisma.starterProgram.findMany.mockResolvedValue([
      { id: 'free', title: 'Free', type: 'SYSTEM', status: 'PUBLISHED', isProOnly: false, goal: 'HEALTH', level: 'BEGINNER', location: 'HOME', requiredEquipment: ['BODYWEIGHT'], createdAt: new Date(), goals: [], levels: [], locations: [] },
      { id: 'pro', title: 'Pro', type: 'SYSTEM', status: 'PUBLISHED', isProOnly: true, goal: 'MUSCLE_GAIN', level: 'ADVANCED', location: 'GYM', requiredEquipment: ['BARBELL'], createdAt: new Date(), goals: [], levels: [], locations: [] },
    ]);
    const result = await service().list('u', {});
    expect(result.items.map((item: any) => item.id)).toEqual(['free']);
  });

  it('returns null when the user has no active program', async () => {
    prisma.userProgramAssignment.findFirst.mockResolvedValue(null);
    await expect(service().active('u')).resolves.toEqual({ activeProgram: null });
  });

  it('forbids editing another user program', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'other', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] });
    await expect(service().update('u', 'p1', { version: 1, title: 'Hack' } as any, 'key')).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
  });

  it('forbids editing an archived program', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'ARCHIVED', version: 1, workouts: [] });
    await expect(service().update('u', 'p1', { version: 1, title: 'Hack' } as any, 'key')).rejects.toMatchObject({ response: { code: 'PROGRAM_STRUCTURE_INVALID' } });
  });

  it('adds a training day to a program', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] });
    prisma.programWorkout.findMany.mockResolvedValue([]);
    prisma.programWorkout.create.mockResolvedValue({ id: 'd1', position: 1 });
    prisma.starterProgram.update.mockResolvedValue({ id: 'p1', version: 2 });
    const result = await service().addDay('u', 'p1', { title: 'День 1', version: 1 } as any, 'key');
    expect(prisma.programWorkout.create).toHaveBeenCalled();
  });

  it('adds an exercise to a training day', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] });
    prisma.programWorkout.findMany.mockResolvedValue([{ id: 'd1', exercises: [] }]);
    prisma.exerciseCatalogItem.findUnique.mockResolvedValue({ id: 'e1', active: true, isSystem: true, isProOnly: false });
    prisma.programWorkoutExercise.create.mockResolvedValue({ id: 'pe1', position: 1 });
    prisma.programExerciseSet.create.mockResolvedValue({ id: 's1' });
    prisma.starterProgram.update.mockResolvedValue({ id: 'p1', version: 2 });
    const result = await service().addExercise('u', 'p1', 'd1', { exerciseId: 'e1', version: 1, plannedSets: 3, plannedRepsMin: 8, plannedRepsMax: 12 } as any, 'key');
    expect(prisma.programWorkoutExercise.create).toHaveBeenCalled();
  });

  it('rejects adding exercise without sets', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] });
    prisma.programWorkout.findMany.mockResolvedValue([{ id: 'd1', exercises: [] }]);
    prisma.exerciseCatalogItem.findUnique.mockResolvedValue({ id: 'e1', active: true, isSystem: true, isProOnly: false });
    await expect(service().addExercise('u', 'p1', 'd1', { exerciseId: 'e1', version: 1, plannedSets: 0, plannedRepsMin: 8, plannedRepsMax: 12 } as any, 'key')).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });

  it('rejects plannedRepsMax below plannedRepsMin', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] });
    prisma.programWorkout.findMany.mockResolvedValue([{ id: 'd1', exercises: [] }]);
    prisma.exerciseCatalogItem.findUnique.mockResolvedValue({ id: 'e1', active: true, isSystem: true, isProOnly: false });
    await expect(service().addExercise('u', 'p1', 'd1', { exerciseId: 'e1', version: 1, plannedRepsMin: 12, plannedRepsMax: 8 } as any, 'key')).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });

  it('reorders training days', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] });
    prisma.programWorkout.findMany.mockResolvedValue([{ id: 'd1', position: 1 }, { id: 'd2', position: 2 }]);
    prisma.starterProgram.update.mockResolvedValue({ id: 'p1', version: 2 });
    const result = await service().reorderDays('u', 'p1', { version: 1, items: [{ id: 'd2', orderIndex: 1 }, { id: 'd1', orderIndex: 2 }] }, 'key');
    expect(result).toBeDefined();
  });

  it('reorders exercises within a day', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] });
    prisma.programWorkoutExercise.findMany.mockResolvedValue([{ id: 'pe1', position: 1 }, { id: 'pe2', position: 2 }]);
    prisma.starterProgram.update.mockResolvedValue({ id: 'p1', version: 2 });
    const result = await service().reorderExercises('u', 'p1', 'd1', { version: 1, items: [{ id: 'pe2', orderIndex: 1 }, { id: 'pe1', orderIndex: 2 }] }, 'key');
    expect(result).toBeDefined();
  });

  it('duplicates a training day', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [{ id: 'd1', title: 'Day 1', exercises: [] }] });
    prisma.programWorkout.findMany.mockResolvedValue([{ id: 'd1', position: 1 }]);
    prisma.programWorkout.create.mockResolvedValue({ id: 'd2', position: 2 });
    prisma.programExerciseSet.findMany.mockResolvedValue([]);
    prisma.starterProgram.update.mockResolvedValue({ id: 'p1', version: 2 });
    const result = await service().duplicateDay('u', 'p1', 'd1', { version: 1 }, 'key');
    expect(result).toBeDefined();
  });

  it('deletes a training day from draft', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] });
    prisma.programWorkout.findFirst.mockResolvedValue({ id: 'd1', programId: 'p1' });
    prisma.programWorkout.delete.mockResolvedValue();
    prisma.starterProgram.update.mockResolvedValue({ id: 'p1', version: 2 });
    const result = await service().deleteDay('u', 'p1', 'd1', { version: 1 }, 'key');
    expect(result).toBeDefined();
    expect(prisma.programWorkout.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('deletes an exercise from a day', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] });
    prisma.programWorkoutExercise.findFirst.mockResolvedValue({ id: 'pe1', programWorkoutId: 'd1' });
    prisma.programWorkoutExercise.delete.mockResolvedValue();
    prisma.starterProgram.update.mockResolvedValue({ id: 'p1', version: 2 });
    const result = await service().deleteExercise('u', 'p1', 'd1', 'pe1', { version: 1 }, 'key');
    expect(result).toBeDefined();
  });

  it('copies a system program', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'sys1', ownerId: null, type: 'SYSTEM', status: 'PUBLISHED', title: 'System', workouts: [] });
    prisma.starterProgram.count.mockResolvedValue(0);
    prisma.starterProgram.create.mockResolvedValue({ id: 'copy1', type: 'USER_CUSTOM' });
    const result = await service().copy('u', 'sys1', 'key');
    expect(result).toBeDefined();
  });

  it('forbids copying a program not owned by user', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'other', type: 'USER_CUSTOM', status: 'DRAFT', workouts: [] });
    await expect(service().copy('u', 'p1', 'key')).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
  });

it('activates a program and creates assignment', async () => {
     prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [{ id: 'd1', isRestDay: false, exercises: [{ id: 'pe1', exercise: { title: 'Squat', muscleGroup: 'QUADRICEPS', equipment: 'BARBELL', techniqueUrl: null }, sets: [{ setNumber: 1 }], plannedSets: [{ setNumber: 1 }] }] }] });
     prisma.subscriptionEntitlement.findUnique.mockResolvedValue({ plan: 'FREE' });
     prisma.userProgramAssignment.findFirst.mockResolvedValue(null);
     prisma.userProgramAssignment.updateMany.mockResolvedValue();
     prisma.starterProgram.update.mockResolvedValue();
     prisma.userProgramAssignment.upsert.mockResolvedValue({ id: 'a1', status: 'ACTIVE' });
     prisma.workout.create.mockResolvedValue({ id: 'w1' });
     const result = await service().activate('u', 'p1', 'key');
     expect(result).toBeDefined();
     expect(result.assignment.id).toBe('a1');
   });

  it('rejects activation without training days', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [{ id: 'd1', isRestDay: true, exercises: [] }] });
    prisma.subscriptionEntitlement.findUnique.mockResolvedValue({ plan: 'FREE' });
    await expect(service().activate('u', 'p1', 'key')).rejects.toMatchObject({ response: { code: 'PROGRAM_STRUCTURE_INVALID' } });
  });

  it('rejects activation without exercises in day', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [{ id: 'd1', isRestDay: false, exercises: [] }] });
    prisma.subscriptionEntitlement.findUnique.mockResolvedValue({ plan: 'FREE' });
    await expect(service().activate('u', 'p1', 'key')).rejects.toMatchObject({ response: { code: 'PROGRAM_STRUCTURE_INVALID' } });
  });

  it('archives a program', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [] });
    prisma.starterProgram.update.mockResolvedValue();
    const result = await service().archive('u', 'p1', 'key');
    expect(result.archived).toBe(true);
  });

  it('rejects archiving another user program', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'other', type: 'USER_CUSTOM', status: 'DRAFT', workouts: [] });
    await expect(service().archive('u', 'p1', 'key')).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
  });

  it('enforces Free active program limit on activation', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [{ id: 'd1', isRestDay: false, exercises: [{ id: 'pe1', sets: [{ setNumber: 1 }], plannedSets: [{ setNumber: 1 }] }] }] });
    prisma.subscriptionEntitlement.findUnique.mockResolvedValue({ plan: 'FREE', maxActiveCustomPrograms: 1 });
    prisma.starterProgram.count.mockResolvedValue(1);
    await expect(service().activate('u', 'p1', 'key')).rejects.toMatchObject({ response: { code: 'PLAN_LIMIT_EXCEEDED' } });
  });

  it('returns program detail with days and exercises', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({
      id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1,
      workouts: [{ id: 'd1', position: 1, title: 'Day 1', isRestDay: false, exercises: [{ id: 'pe1', position: 1, exerciseId: 'e1', exercise: { title: 'Squat' }, sets: [{ setNumber: 1 }], plannedSets: [{ setNumber: 1 }] }] }],
    });
    const result = await service().get('u', 'p1');
    expect(result.days.length).toBe(1);
    expect(result.days[0].exercises.length).toBe(1);
    expect(result.days[0].exercises[0].title).toBe('Squat');
  });

  it('sorts days by position', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({
      id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1,
      workouts: [{ id: 'd1', position: 1 }, { id: 'd2', position: 2 }],
    });
    const result = await service().get('u', 'p1');
    expect(result.days.map((d: any) => d.orderIndex)).toEqual([1, 2]);
  });

  it('sorts exercises by position within day', async () => {
    prisma.starterProgram.findUnique.mockResolvedValue({
      id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1,
      workouts: [{ id: 'd1', position: 1, exercises: [{ id: 'pe1', position: 1 }, { id: 'pe2', position: 2 }] }],
    });
    const result = await service().get('u', 'p1');
    expect(result.days[0].exercises.map((e: any) => e.orderIndex)).toEqual([1, 2]);
  });

it('blocks Pro features for Free users', async () => {
     prisma.starterProgram.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'u', type: 'USER_CUSTOM', status: 'DRAFT', version: 1, workouts: [], isProOnly: true });
     prisma.subscriptionEntitlement.findUnique.mockResolvedValue({ plan: 'FREE' });
     await expect(service().activate('u', 'p1', 'key')).rejects.toMatchObject({ response: { code: 'PRO_FEATURE_REQUIRED' } });
   });
});
