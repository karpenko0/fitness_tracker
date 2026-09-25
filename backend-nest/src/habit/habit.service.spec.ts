import { createHash } from 'crypto';
import { IdempotencyService } from '../common/services/idempotency.service';
import { CreateHabitDto } from './dto/create-habit.dto';
import { HabitService } from './habit.service';
import { HabitTaskService } from './habit-task.service';
import { HabitLocalDateService } from './habit-local-date.service';
import { HabitValidationService } from './habit-validation.service';

describe('HabitService', () => {
  const prisma: any = {
    habit: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    idempotencyKey: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    habitTask: { upsert: jest.fn().mockResolvedValue({ id: 't1', habitId: 'h1', localDate: new Date('2026-09-25'), status: 'PENDING', progressValue: null, version: 1 }) },
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
  };

  const service = () =>
    new HabitService(
      prisma,
      new HabitValidationService(),
      new IdempotencyService(prisma),
      new HabitTaskService(prisma, new HabitLocalDateService(), new IdempotencyService(prisma)),
    );

  const waterDto = (): CreateHabitDto =>
    ({ title: 'Пить воду', type: 'WATER', goalType: 'COUNT', goalValue: 2000, unit: 'ML', schedule: 'DAILY', timezone: 'Europe/Moscow' } as CreateHabitDto);

  const storedHabit = (overrides: Record<string, unknown> = {}) => ({
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
    timezone: 'Europe/Moscow',
    reminderTime: null,
    telegramChatId: null,
    status: 'ACTIVE',
    pausedAt: null,
    archivedAt: null,
    currentStreak: 0,
    bestStreak: 0,
    version: 1,
    createdAt: new Date('2026-09-25T10:00:00Z'),
    updatedAt: new Date('2026-09-25T10:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.habit.count.mockResolvedValue(0);
    prisma.habit.findFirst.mockResolvedValue(null);
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
  });

  describe('create', () => {
    it('creates an active habit', async () => {
      prisma.habit.create.mockImplementation(({ data }: any) => Promise.resolve(storedHabit(data)));
      const result = await service().create('u', waterDto(), 'key-1');
      expect(result.title).toBe('Пить воду');
      expect(result.status).toBe('ACTIVE');
      expect(prisma.habit.create).toHaveBeenCalledTimes(1);
      expect(prisma.idempotencyKey.create).toHaveBeenCalledTimes(1);
    });

    it('requires an idempotency key', async () => {
      await expect(service().create('u', waterDto())).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
      expect(prisma.habit.create).not.toHaveBeenCalled();
    });

    it('returns stored response on repeated POST with the same key and body', async () => {
      const body = { id: 'h1', title: 'Пить воду' };
      const hash = createHash('sha256').update(JSON.stringify(waterDto())).digest('hex');
      prisma.idempotencyKey.findUnique.mockResolvedValue({ requestHash: hash, responseBody: body });
      await expect(service().create('u', waterDto(), 'key-1')).resolves.toBe(body);
      expect(prisma.habit.create).not.toHaveBeenCalled();
    });

    it('rejects the same key with a different body', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue({ requestHash: 'other-hash', responseBody: {} });
      await expect(service().create('u', waterDto(), 'key-1')).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    });

    it('rejects more than 20 active habits', async () => {
      prisma.habit.count.mockResolvedValue(20);
      await expect(service().create('u', waterDto(), 'key-1')).rejects.toMatchObject({ response: { code: 'HABIT_LIMIT_EXCEEDED' } });
      expect(prisma.habit.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate active habit with the same title', async () => {
      prisma.habit.findFirst.mockResolvedValue(storedHabit());
      await expect(service().create('u', waterDto(), 'key-1')).rejects.toMatchObject({ response: { code: 'DUPLICATE_ACTIVE_HABIT' } });
    });

    it('allows the same title when the other habit is archived', async () => {
      // findFirst фильтрует по status: ACTIVE, поэтому архивная не найдётся
      prisma.habit.findFirst.mockResolvedValue(null);
      prisma.habit.create.mockImplementation(({ data }: any) => Promise.resolve(storedHabit(data)));
      await expect(service().create('u', waterDto(), 'key-1')).resolves.toBeDefined();
      expect(prisma.habit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) }));
    });
  });

  describe('ownership', () => {
    it('returns 404 when reading another user habit', async () => {
      prisma.habit.findFirst.mockResolvedValue(null); // запрос всегда с userId
      await expect(service().get('u', 'h1')).rejects.toMatchObject({ response: { code: 'HABIT_NOT_FOUND' } });
      expect(prisma.habit.findFirst).toHaveBeenCalledWith({ where: { id: 'h1', userId: 'u' } });
    });

    it('returns 404 when updating another user habit', async () => {
      await expect(service().update('u', 'h1', { version: 1 } as any, 'key')).rejects.toMatchObject({ response: { code: 'HABIT_NOT_FOUND' } });
    });
  });

  describe('update', () => {
    it('rejects a stale version with 409', async () => {
      prisma.habit.findFirst.mockResolvedValue(storedHabit({ version: 4 }));
      await expect(service().update('u', 'h1', { version: 3, title: 'Новое имя' } as any, 'key')).rejects.toMatchObject({ response: { code: 'HABIT_VERSION_CONFLICT' } });
      expect(prisma.habit.update).not.toHaveBeenCalled();
    });

    it('updates fields and increments version', async () => {
      prisma.habit.findFirst.mockResolvedValueOnce(storedHabit()).mockResolvedValue(null);
      prisma.habit.update.mockImplementation(({ data }: any) =>
        Promise.resolve(storedHabit({ title: 'Вода 2.5л', goalValue: 2500, version: 1 + data.version.increment })),
      );
      const result = await service().update('u', 'h1', { version: 1, title: 'Вода 2.5л', goalValue: 2500 } as any, 'key');
      expect(result.title).toBe('Вода 2.5л');
      expect(result.goalValue).toBe(2500);
      expect(result.version).toBe(2);
    });

    it('re-validates merged state (MEDICATION cannot switch to COUNT)', async () => {
      prisma.habit.findFirst.mockResolvedValue(storedHabit({ type: 'MEDICATION', goalType: 'BOOLEAN', goalValue: null, unit: null }));
      await expect(service().update('u', 'h1', { version: 1, goalType: 'COUNT', goalValue: 1, unit: 'TIMES' } as any, 'key')).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    });
  });

  describe('status transitions', () => {
    it('pauses an active habit', async () => {
      prisma.habit.findFirst.mockResolvedValue(storedHabit());
      prisma.habit.update.mockImplementation(({ data }: any) => Promise.resolve(storedHabit({ status: data.status, version: 2 })));
      const result = await service().pause('u', 'h1', 'key');
      expect(result.status).toBe('PAUSED');
    });

    it('cannot pause an already paused habit', async () => {
      prisma.habit.findFirst.mockResolvedValue(storedHabit({ status: 'PAUSED' }));
      await expect(service().pause('u', 'h1', 'key')).rejects.toMatchObject({ response: { code: 'HABIT_STATUS_INVALID' } });
    });

    it('cannot resume an active habit', async () => {
      prisma.habit.findFirst.mockResolvedValue(storedHabit({ status: 'ACTIVE' }));
      await expect(service().resume('u', 'h1', 'key')).rejects.toMatchObject({ response: { code: 'HABIT_STATUS_INVALID' } });
    });

    it('resumes a paused habit', async () => {
      prisma.habit.findFirst.mockResolvedValue(storedHabit({ status: 'PAUSED' }));
      prisma.habit.update.mockImplementation(({ data }: any) => Promise.resolve(storedHabit({ status: data.status, version: 2 })));
      const result = await service().resume('u', 'h1', 'key');
      expect(result.status).toBe('ACTIVE');
    });

    it('archives an active habit and rejects archiving twice', async () => {
      prisma.habit.findFirst.mockResolvedValue(storedHabit());
      prisma.habit.update.mockImplementation(({ data }: any) => Promise.resolve(storedHabit({ status: data.status, version: 2 })));
      await expect(service().archive('u', 'h1', 'key')).resolves.toMatchObject({ status: 'ARCHIVED' });

      prisma.habit.findFirst.mockResolvedValue(storedHabit({ status: 'ARCHIVED' }));
      await expect(service().archive('u', 'h1', 'key-2')).rejects.toMatchObject({ response: { code: 'HABIT_STATUS_INVALID' } });
    });

    it('cannot pause an archived habit', async () => {
      prisma.habit.findFirst.mockResolvedValue(storedHabit({ status: 'ARCHIVED' }));
      await expect(service().pause('u', 'h1', 'key')).rejects.toMatchObject({ response: { code: 'HABIT_STATUS_INVALID' } });
    });
  });

  describe('list', () => {
    it('pages results and counts total', async () => {
      prisma.habit.count.mockResolvedValue(42);
      prisma.habit.findMany.mockResolvedValue([storedHabit()]);
      const result = await service().list('u', { page: 2, pageSize: 20 });
      expect(result).toMatchObject({ page: 2, pageSize: 20, total: 42 });
      expect(result.items).toHaveLength(1);
      expect(prisma.habit.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20, where: { userId: 'u' } }));
    });
  });
});
