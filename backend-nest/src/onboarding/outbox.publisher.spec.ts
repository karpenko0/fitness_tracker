import { OnboardingOutboxPublisher } from './outbox.publisher';

describe('OnboardingOutboxPublisher', () => {
  const metrics = { increment: jest.fn() };

  it('calculates progression before marking workout.completed as published', async () => {
    const prisma = {
      outboxEvent: {
        findMany: jest.fn().mockResolvedValue([{ id: 'event-1', userId: 'user-1', type: 'workout.completed', payload: { workoutId: 'workout-1' }, attempts: 0 }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const dashboard = { invalidateUser: jest.fn().mockResolvedValue(undefined) };
    const progression = { handleWorkoutCompleted: jest.fn().mockResolvedValue(undefined) };
    const publisher = new OnboardingOutboxPublisher(prisma as any, dashboard as any, progression as any, metrics as any);

    await publisher.publish();

    expect(prisma.outboxEvent.updateMany).toHaveBeenCalled();
    expect(progression.handleWorkoutCompleted).toHaveBeenCalledWith({ workoutId: 'workout-1' });
    expect(dashboard.invalidateUser).toHaveBeenCalledWith('user-1', 'workout.completed');
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({ where: { id: 'event-1' }, data: expect.objectContaining({ publishedAt: expect.any(Date), lockedAt: null }) });
  });

  it('schedules retry instead of publishing when progression calculation fails', async () => {
    const prisma = {
      outboxEvent: {
        findMany: jest.fn().mockResolvedValue([{ id: 'event-1', userId: 'user-1', type: 'workout.completed', payload: { workoutId: 'workout-1' }, attempts: 0 }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
    };
    const dashboard = { invalidateUser: jest.fn() };
    const progression = { handleWorkoutCompleted: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    const publisher = new OnboardingOutboxPublisher(prisma as any, dashboard as any, progression as any, metrics as any);

    await publisher.publish();

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({ where: { id: 'event-1' }, data: expect.objectContaining({ attempts: 1, lockedAt: null, lastError: 'database unavailable' }) });
    expect(metrics.increment).toHaveBeenCalledWith('progression_outbox_retry_total', { type: 'workout.completed', status: 'retry' });
  });

  it('does not invoke progression for unrelated outbox events', async () => {
    const prisma = {
      outboxEvent: {
        findMany: jest.fn().mockResolvedValue([{ id: 'event-2', userId: 'user-1', type: 'profile.updated', payload: {}, attempts: 0 }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const dashboard = { invalidateUser: jest.fn().mockResolvedValue(undefined) };
    const progression = { handleWorkoutCompleted: jest.fn() };

    await new OnboardingOutboxPublisher(prisma as any, dashboard as any, progression as any, metrics as any).publish();

    expect(progression.handleWorkoutCompleted).not.toHaveBeenCalled();
    expect(prisma.outboxEvent.update).toHaveBeenCalledTimes(1);
  });
});
