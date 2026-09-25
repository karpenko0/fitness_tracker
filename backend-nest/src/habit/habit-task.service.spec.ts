import { IdempotencyService } from '../common/services/idempotency.service';
import { HabitLocalDateService } from './habit-local-date.service';
import { HabitTaskService } from './habit-task.service';

describe('HabitTaskService', () => {
  // Пятница, 25.09.2026, 12:00 UTC
  const now = new Date('2026-09-25T12:00:00Z');

  const prisma: any = {
    habit: { findMany: jest.fn().mockResolvedValue([]) },
    habitTask: {
      upsert: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    habitTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    idempotencyKey: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
  };

  const service = () => new HabitTaskService(prisma, new HabitLocalDateService(), new IdempotencyService(prisma));

  const habit = (overrides: Record<string, unknown> = {}) => ({
    id: 'h1',
    userId: 'u',
    title: 'Пить воду',
    type: 'WATER',
    goalType: 'COUNT',
    goalValue: 2000,
    unit: 'ML',
    schedule: 'DAILY',
    weekdays: [],
    oneTimeDate: null,
    timezone: 'UTC',
    reminderTime: null,
    status: 'ACTIVE',
    currentStreak: 0,
    bestStreak: 0,
    version: 1,
    ...overrides,
  });

  const task = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    habitId: 'h1',
    localDate: new Date('2026-09-25T00:00:00Z'),
    status: 'PENDING',
    progressValue: null,
    completedAt: null,
    skippedAt: null,
    expiredAt: null,
    version: 1,
    habit: habit(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.habit.findMany.mockResolvedValue([]);
    prisma.habitTask.findFirst.mockResolvedValue(null);
    prisma.habitTask.findMany.mockResolvedValue([]);
    prisma.habitTask.updateMany.mockResolvedValue({ count: 0 });
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.habitTask.upsert.mockImplementation(({ create }: any) => Promise.resolve({ id: 't1', ...create }));
  });

  describe('ensureTaskForHabit — генерация заданий', () => {
    it('creates one task on the local date for an active DAILY habit', async () => {
      await service().ensureTaskForHabit(habit({ timezone: 'Europe/Moscow' }), new Date('2026-09-25T23:30:00Z'));
      // 23:30 UTC = 26.09 в Москве
      expect(prisma.habitTask.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { habitId_localDate: { habitId: 'h1', localDate: new Date('2026-09-26T00:00:00Z') } },
          create: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
    });

    it('creates WEEKDAYS tasks only on selected days', async () => {
      // Пятница = 5
      await service().ensureTaskForHabit(habit({ schedule: 'WEEKDAYS', weekdays: [1, 3, 5] }), now);
      expect(prisma.habitTask.upsert).toHaveBeenCalledTimes(1);

      prisma.habitTask.upsert.mockClear();
      await service().ensureTaskForHabit(habit({ schedule: 'WEEKDAYS', weekdays: [1, 3] }), now);
      expect(prisma.habitTask.upsert).not.toHaveBeenCalled();
    });

    it('creates a ONE_TIME task on the specified date', async () => {
      await service().ensureTaskForHabit(habit({ schedule: 'ONE_TIME', oneTimeDate: new Date('2026-10-01T00:00:00Z') }), now);
      expect(prisma.habitTask.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { habitId_localDate: { habitId: 'h1', localDate: new Date('2026-10-01T00:00:00Z') } },
        }),
      );
    });

    it('does not create tasks for PAUSED and ARCHIVED habits', async () => {
      await service().ensureTaskForHabit(habit({ status: 'PAUSED' }), now);
      await service().ensureTaskForHabit(habit({ status: 'ARCHIVED' }), now);
      expect(prisma.habitTask.upsert).not.toHaveBeenCalled();
    });

    it('is idempotent: repeated runs upsert the same (habitId, localDate)', async () => {
      await service().ensureTaskForHabit(habit(), now);
      await service().ensureTaskForHabit(habit(), now);
      const [first, second] = prisma.habitTask.upsert.mock.calls;
      expect(first[0].where).toEqual(second[0].where);
    });

    it('survives a uniqueness race (P2002) by returning the existing task', async () => {
      prisma.habitTask.upsert.mockRejectedValueOnce({ code: 'P2002' });
      prisma.habitTask.findUnique = jest.fn().mockResolvedValue({ id: 't-existing' });
      const result = await service().ensureTaskForHabit(habit(), now);
      expect(result).toMatchObject({ id: 't-existing' });
    });

    it('worker pass covers all active habits', async () => {
      prisma.habit.findMany.mockResolvedValue([
        habit(),
        habit({ id: 'h2', schedule: 'WEEKDAYS', weekdays: [6] }), // суббота — не сегодня
      ]);
      const ensured = await service().generateForAllActiveHabits(now);
      expect(ensured).toBe(1);
      expect(prisma.habitTask.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateProgress — ADD и SET', () => {
    it('ADD increases current progress', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ progressValue: 250 }));
      prisma.habitTask.update.mockImplementation(({ data }: any) => Promise.resolve(task({ ...data, progressValue: data.progressValue })));
      const result = await service().updateProgress('u', 'h1', 't1', { action: 'ADD', value: 250, version: 1 }, 'k1');
      expect(result.progressValue).toBe(500);
      expect(result.status).toBe('PENDING');
    });

    it('SET replaces current progress', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ progressValue: 250 }));
      prisma.habitTask.update.mockImplementation(({ data }: any) => Promise.resolve(task({ progressValue: data.progressValue, status: data.status })));
      const result = await service().updateProgress('u', 'h1', 't1', { action: 'SET', value: 100, version: 1 }, 'k2');
      expect(result.progressValue).toBe(100);
    });

    it('completes the task when the goal is reached or exceeded', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ progressValue: 1900 }));
      prisma.habitTask.update.mockImplementation(({ data }: any) => Promise.resolve(task({ status: data.status, progressValue: data.progressValue, completedAt: data.completedAt })));
      const result = await service().updateProgress('u', 'h1', 't1', { action: 'ADD', value: 100, version: 1 }, 'k3');
      expect(result.status).toBe('COMPLETED');
      expect(result.completedAt).not.toBeNull();

      const exceeded = await service().updateProgress('u', 'h1', 't1', { action: 'SET', value: 5000, version: 1 }, 'k4');
      expect(exceeded.status).toBe('COMPLETED');
    });

    it('rejects negative values with 400 VALIDATION_ERROR', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task());
      await expect(service().updateProgress('u', 'h1', 't1', { action: 'ADD', value: -100, version: 1 }, 'k5')).rejects.toMatchObject({
        response: { code: 'VALIDATION_ERROR' },
      });
      expect(prisma.habitTask.update).not.toHaveBeenCalled();
    });

    it('rejects a numeric value for a BOOLEAN habit', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ habit: habit({ type: 'MEDICATION', goalType: 'BOOLEAN', goalValue: null, unit: null }) }));
      await expect(service().updateProgress('u', 'h1', 't1', { action: 'SET', value: 1, version: 1 }, 'k6')).rejects.toMatchObject({
        response: { code: 'VALIDATION_ERROR' },
      });
    });

    it('completes a BOOLEAN task without a numeric value', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ habit: habit({ type: 'MEDICATION', goalType: 'BOOLEAN', goalValue: null, unit: null }) }));
      prisma.habitTask.update.mockImplementation(({ data }: any) => Promise.resolve(task({ status: data.status, completedAt: data.completedAt })));
      const result = await service().updateProgress('u', 'h1', 't1', { action: 'SET', version: 1 }, 'k7');
      expect(result.status).toBe('COMPLETED');
    });

    it('rejects a stale task version with 409', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ version: 3 }));
      await expect(service().updateProgress('u', 'h1', 't1', { action: 'ADD', value: 100, version: 2 }, 'k8')).rejects.toMatchObject({
        response: { code: 'HABIT_TASK_VERSION_CONFLICT' },
      });
    });

    it('rejects updating an already closed task', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ status: 'COMPLETED' }));
      await expect(service().updateProgress('u', 'h1', 't1', { action: 'ADD', value: 100, version: 1 }, 'k9')).rejects.toMatchObject({
        response: { code: 'TASK_ALREADY_CLOSED' },
      });
    });

    it("returns 404 for another user's task", async () => {
      await expect(service().updateProgress('u', 'h1', 't1', { action: 'ADD', value: 100, version: 1 }, 'k10')).rejects.toMatchObject({
        response: { code: 'HABIT_TASK_NOT_FOUND' },
      });
      expect(prisma.habitTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't1', habitId: 'h1', habit: { userId: 'u' } } }),
      );
    });

    it('records an ADD/SET event', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task());
      prisma.habitTask.update.mockResolvedValue(task());
      await service().updateProgress('u', 'h1', 't1', { action: 'ADD', value: 100, version: 1 }, 'k11');
      expect(prisma.habitTaskEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'ADD', value: 100, source: 'API' }) }),
      );
    });
  });

  describe('skip', () => {
    it('skips a pending task', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task());
      prisma.habitTask.update.mockImplementation(({ data }: any) => Promise.resolve(task({ status: data.status, skippedAt: data.skippedAt })));
      const result = await service().skip('u', 'h1', 't1', 1, 'k12');
      expect(result.status).toBe('SKIPPED');
      expect(result.skippedAt).not.toBeNull();
    });

    it('cannot skip a completed task', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ status: 'COMPLETED' }));
      await expect(service().skip('u', 'h1', 't1', 1, 'k13')).rejects.toMatchObject({ response: { code: 'TASK_ALREADY_CLOSED' } });
    });
  });

  describe('expireOverdueTasks', () => {
    it('expires pending tasks whose local day has ended', async () => {
      prisma.habitTask.findMany.mockResolvedValue([
        task({ id: 't-old', localDate: new Date('2026-09-24T00:00:00Z'), habit: habit({ timezone: 'UTC' }) }), // вчера
        task({ id: 't-today', localDate: new Date('2026-09-25T00:00:00Z'), habit: habit({ timezone: 'UTC' }) }), // сегодня — ещё не истекло
      ]);
      prisma.habitTask.updateMany.mockResolvedValue({ count: 1 });
      const expired = await service().expireOverdueTasks(now);
      expect(expired).toBe(1);
      expect(prisma.habitTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['t-old'] }, status: 'PENDING' }, data: expect.objectContaining({ status: 'EXPIRED' }) }),
      );
    });

    it('respects the habit timezone: the day has not ended elsewhere yet', async () => {
      // 25.09 23:00 UTC: в Москве уже 26-е (задание от 25-го истекло), на Гавайях ещё 25-е (не истекло)
      const lateUtc = new Date('2026-09-25T23:00:00Z');
      prisma.habitTask.findMany.mockResolvedValue([
        task({ id: 't-msk', localDate: new Date('2026-09-25T00:00:00Z'), habit: habit({ timezone: 'Europe/Moscow' }) }),
        task({ id: 't-hnl', localDate: new Date('2026-09-25T00:00:00Z'), habit: habit({ id: 'h2', timezone: 'Pacific/Honolulu' }) }),
      ]);
      prisma.habitTask.updateMany.mockResolvedValue({ count: 1 });
      await service().expireOverdueTasks(lateUtc);
      expect(prisma.habitTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['t-msk'] }, status: 'PENDING' } }),
      );
    });

    it('never touches completed tasks', async () => {
      await service().expireOverdueTasks(now);
      expect(prisma.habitTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PENDING' }, include: { habit: { select: { timezone: true } } } }),
      );
    });

    it('does nothing when there are no overdue tasks', async () => {
      prisma.habitTask.findMany.mockResolvedValue([]);
      const expired = await service().expireOverdueTasks(now);
      expect(expired).toBe(0);
      expect(prisma.habitTask.updateMany).not.toHaveBeenCalled();
    });
  });
});
