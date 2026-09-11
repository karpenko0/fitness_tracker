import { WorkoutService } from './workout.service';
import { createHash } from 'crypto';

describe('WorkoutService lifecycle', () => {
  const base = () => ({
    idempotencyKey: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    workout: { findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn() },
    workoutSession: { create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    outboxEvent: { create: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(undefined)),
  });

  it('requires an idempotency key for state-changing operations', async () => {
    const prisma = base();
    await expect(new WorkoutService(prisma as any).transition('u', 'w', 'start')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED' }) });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a workout owned by another user', async () => {
    const prisma = base();
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(prisma));
    prisma.workout.findFirst.mockResolvedValue(null);
    await expect(new WorkoutService(prisma as any).transition('u', ' чужой', 'start', 'key')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'WORKOUT_NOT_FOUND' }) });
  });

  it('returns the idempotent response without repeating a transition', async () => {
    const prisma = base();
    const response = { workout: { id: 'w', status: 'IN_PROGRESS' } };
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(prisma));
    prisma.idempotencyKey.findUnique.mockResolvedValue({ requestHash: createHash('sha256').update(JSON.stringify({ workoutId: 'w', transition: 'start' })).digest('hex'), responseBody: response });
    const service = new WorkoutService(prisma as any);
    const result = await service.transition('u', 'w', 'start', 'key').catch(() => undefined);
    expect(prisma.workout.findFirst).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
