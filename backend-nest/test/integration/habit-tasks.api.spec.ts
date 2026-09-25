// SPEC-009 integration: задания привычек — GET /habits/today, прогресс (ADD/SET), пропуск.
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { HabitController } from '../../src/habit/habit.controller';
import { HabitService } from '../../src/habit/habit.service';
import { HabitTaskService } from '../../src/habit/habit-task.service';
import { HabitLocalDateService } from '../../src/habit/habit-local-date.service';
import { HabitStreakService } from '../../src/habit/habit-streak.service';
import { HabitValidationService } from '../../src/habit/habit-validation.service';
import { IdempotencyService } from '../../src/common/services/idempotency.service';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

describe('Habit tasks API (integration)', () => {
  let app: INestApplication;
  const auth = { Authorization: 'Bearer test-token' };

  const prisma: any = {
    habit: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
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
    telegramChatId: null,
    status: 'ACTIVE',
    pausedAt: null,
    archivedAt: null,
    currentStreak: 0,
    bestStreak: 0,
    version: 1,
    createdAt: new Date('2026-09-20T10:00:00Z'),
    updatedAt: new Date('2026-09-20T10:00:00Z'),
    ...overrides,
  });

  const task = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    habitId: 'h1',
    localDate: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'), // сегодняшняя UTC-дата
    status: 'PENDING',
    progressValue: null,
    completedAt: null,
    skippedAt: null,
    expiredAt: null,
    version: 1,
    habit: habit(),
    ...overrides,
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HabitController],
      providers: [HabitService, HabitTaskService, HabitStreakService, HabitLocalDateService, HabitValidationService, IdempotencyService, { provide: PrismaClient, useValue: prisma }],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = { userId: 'u', roles: ['USER'] };
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) => new BadRequestException({ code: 'VALIDATION_ERROR', details: errors }),
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.habit.findMany.mockResolvedValue([]);
    prisma.habit.findFirst.mockResolvedValue(null);
    prisma.habitTask.findFirst.mockResolvedValue(null);
    prisma.habitTask.findMany.mockResolvedValue([]);
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
  });

  describe('GET /api/v1/habits/today', () => {
    it('returns today items and is not swallowed by the /habits/:id route', async () => {
      const todayUtc = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
      prisma.habit.findMany.mockResolvedValue([habit()]);
      prisma.habitTask.upsert.mockResolvedValue(task({ localDate: todayUtc }));
      prisma.habitTask.findMany.mockResolvedValue([task({ localDate: todayUtc })]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/habits/today')
        .set(auth)
        .expect(200);
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].habit.title).toBe('Пить воду');
      expect(response.body.data.items[0].task).toMatchObject({ id: 't1', status: 'PENDING' });
      // активная привычка получила задание на сегодня (on-demand генерация)
      expect(prisma.habitTask.upsert).toHaveBeenCalledTimes(1);
    });

    it('returns null task for paused habits', async () => {
      prisma.habit.findMany.mockResolvedValue([habit({ status: 'PAUSED' })]);
      const response = await request(app.getHttpServer())
        .get('/api/v1/habits/today')
        .set(auth)
        .expect(200);
      expect(response.body.data.items[0].task).toBeNull();
      expect(prisma.habitTask.upsert).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/habits/:id/tasks/:taskId/progress', () => {
    it('ADD increases progress and returns the updated task', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ progressValue: 250 }));
      prisma.habitTask.update.mockImplementation(({ data }: any) =>
        Promise.resolve(task({ progressValue: data.progressValue, status: data.status, version: 2 })),
      );
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits/h1/tasks/t1/progress')
        .set(auth)
        .set('Idempotency-Key', 'p-1')
        .send({ action: 'ADD', value: 250, version: 1 })
        .expect(201);
      expect(response.body.data).toMatchObject({ progressValue: 500, status: 'PENDING', version: 2 });
    });

    it('completes the task when the goal is reached', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ progressValue: 1750 }));
      prisma.habitTask.update.mockImplementation(({ data }: any) =>
        Promise.resolve(task({ progressValue: data.progressValue, status: data.status, completedAt: data.completedAt, version: 2 })),
      );
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits/h1/tasks/t1/progress')
        .set(auth)
        .set('Idempotency-Key', 'p-2')
        .send({ action: 'ADD', value: 250, version: 1 })
        .expect(201);
      expect(response.body.data).toMatchObject({ progressValue: 2000, status: 'COMPLETED' });
    });

    it('rejects a negative value with 400 VALIDATION_ERROR', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits/h1/tasks/t1/progress')
        .set(auth)
        .set('Idempotency-Key', 'p-3')
        .send({ action: 'ADD', value: -5, version: 1 })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a numeric value for a BOOLEAN habit with 400', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ habit: habit({ type: 'MEDICATION', goalType: 'BOOLEAN', goalValue: null, unit: null }) }));
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits/h1/tasks/t1/progress')
        .set(auth)
        .set('Idempotency-Key', 'p-4')
        .send({ action: 'SET', value: 1, version: 1 })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('requires Idempotency-Key and detects reuse with a different body', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/habits/h1/tasks/t1/progress')
        .set(auth)
        .send({ action: 'ADD', value: 100, version: 1 })
        .expect(409)
        .expect((res) => expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED'));

      prisma.idempotencyKey.findUnique.mockResolvedValue({ requestHash: 'other-hash', responseBody: {} });
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits/h1/tasks/t1/progress')
        .set(auth)
        .set('Idempotency-Key', 'p-5')
        .send({ action: 'ADD', value: 100, version: 1 })
        .expect(409);
      expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('repeated POST with the same key and body does not double progress', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ progressValue: 0 }));
      prisma.habitTask.update.mockImplementation(({ data }: any) =>
        Promise.resolve(task({ progressValue: data.progressValue, status: data.status, version: 2 })),
      );
      await request(app.getHttpServer())
        .post('/api/v1/habits/h1/tasks/t1/progress')
        .set(auth)
        .set('Idempotency-Key', 'p-6')
        .send({ action: 'ADD', value: 250, version: 1 })
        .expect(201);
      expect(prisma.habitTask.update).toHaveBeenCalledTimes(1);

      const storedHash = prisma.idempotencyKey.create.mock.calls[0][0].data.requestHash;
      const storedBody = prisma.idempotencyKey.create.mock.calls[0][0].data.responseBody;
      prisma.idempotencyKey.findUnique.mockResolvedValue({ requestHash: storedHash, responseBody: storedBody });

      const response = await request(app.getHttpServer())
        .post('/api/v1/habits/h1/tasks/t1/progress')
        .set(auth)
        .set('Idempotency-Key', 'p-6')
        .send({ action: 'ADD', value: 250, version: 1 })
        .expect(201);
      expect(response.body.data).toEqual(JSON.parse(JSON.stringify(storedBody)));
      expect(prisma.habitTask.update).toHaveBeenCalledTimes(1); // без двойного увеличения
    });

    it('returns 409 on stale task version', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ version: 4 }));
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits/h1/tasks/t1/progress')
        .set(auth)
        .set('Idempotency-Key', 'p-7')
        .send({ action: 'ADD', value: 100, version: 3 })
        .expect(409);
      expect(response.body.error.code).toBe('HABIT_TASK_VERSION_CONFLICT');
    });
  });

  describe('POST /api/v1/habits/:id/tasks/:taskId/skip', () => {
    it('skips a pending task', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task());
      prisma.habitTask.update.mockImplementation(({ data }: any) =>
        Promise.resolve(task({ status: data.status, skippedAt: data.skippedAt, version: 2 })),
      );
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits/h1/tasks/t1/skip')
        .set(auth)
        .set('Idempotency-Key', 's-1')
        .send({ version: 1 })
        .expect(201);
      expect(response.body.data).toMatchObject({ status: 'SKIPPED' });
    });

    it('cannot skip a completed task', async () => {
      prisma.habitTask.findFirst.mockResolvedValue(task({ status: 'COMPLETED' }));
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits/h1/tasks/t1/skip')
        .set(auth)
        .set('Idempotency-Key', 's-2')
        .send({ version: 1 })
        .expect(409);
      expect(response.body.error.code).toBe('TASK_ALREADY_CLOSED');
    });
  });
});
