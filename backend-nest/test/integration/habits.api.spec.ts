// SPEC-009 integration: habits API поверх реального контроллера и сервиса, Prisma — mock.
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { HabitController } from '../../src/habit/habit.controller';
import { HabitService } from '../../src/habit/habit.service';
import { HabitTaskService } from '../../src/habit/habit-task.service';
import { HabitLocalDateService } from '../../src/habit/habit-local-date.service';
import { HabitValidationService } from '../../src/habit/habit-validation.service';
import { IdempotencyService } from '../../src/common/services/idempotency.service';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

describe('Habits API (integration)', () => {
  let app: INestApplication;
  const accessToken = 'test-token';

  const prisma: any = {
    habit: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    idempotencyKey: { findUnique: jest.fn(), create: jest.fn() },
    habitTask: {
      upsert: jest.fn().mockResolvedValue({ id: 't1', habitId: 'h1', localDate: new Date('2026-09-25'), status: 'PENDING', progressValue: null, completedAt: null, skippedAt: null, expiredAt: null, version: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
  };

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

  const waterBody = {
    title: 'Пить воду',
    type: 'WATER',
    goalType: 'COUNT',
    goalValue: 2000,
    unit: 'ML',
    schedule: 'DAILY',
    timezone: 'Europe/Moscow',
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HabitController],
      providers: [HabitService, HabitTaskService, HabitLocalDateService, HabitValidationService, IdempotencyService, { provide: PrismaClient, useValue: prisma }],
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

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.habit.count.mockResolvedValue(0);
    prisma.habit.findFirst.mockResolvedValue(null);
    prisma.habit.findMany.mockResolvedValue([]);
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
  });

  describe('POST /api/v1/habits', () => {
    it('creates a habit and returns 201', async () => {
      prisma.habit.create.mockImplementation(({ data }: any) => Promise.resolve(storedHabit(data)));
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', 'k-1')
        .send(waterBody)
        .expect(201);
      expect(response.body.data).toMatchObject({ title: 'Пить воду', status: 'ACTIVE', goalValue: 2000, unit: 'ML' });
    });

    it('returns 409 IDEMPOTENCY_KEY_REQUIRED without the header', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(waterBody)
        .expect(409);
      expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('returns 400 VALIDATION_ERROR for MEDICATION with COUNT goal', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', 'k-2')
        .send({ ...waterBody, type: 'MEDICATION', unit: 'TIMES', goalValue: 1 })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for habit without title/timezone', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', 'k-3')
        .send({ type: 'WATER', goalType: 'COUNT', goalValue: 2000, unit: 'ML', schedule: 'DAILY' })
        .expect(400);
    });

    it('returns 422 HABIT_LIMIT_EXCEEDED on the 21st active habit', async () => {
      prisma.habit.count.mockResolvedValue(20);
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', 'k-4')
        .send(waterBody)
        .expect(422);
      expect(response.body.error.code).toBe('HABIT_LIMIT_EXCEEDED');
    });

    it('returns 409 DUPLICATE_ACTIVE_HABIT for same active title', async () => {
      prisma.habit.findFirst.mockResolvedValue(storedHabit());
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', 'k-5')
        .send(waterBody)
        .expect(409);
      expect(response.body.error.code).toBe('DUPLICATE_ACTIVE_HABIT');
    });

    it('repeated POST with the same key does not create a duplicate', async () => {
      prisma.habit.create.mockImplementation(({ data }: any) => Promise.resolve(storedHabit(data)));
      await request(app.getHttpServer())
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', 'k-6')
        .send(waterBody)
        .expect(201);
      expect(prisma.habit.create).toHaveBeenCalledTimes(1);
      expect(prisma.idempotencyKey.create).toHaveBeenCalledTimes(1);

      // Второй POST: находим сохранённый ответ по ключу
      const storedResponse = prisma.idempotencyKey.create.mock.calls[0][0].data.responseBody;
      const storedHash = prisma.idempotencyKey.create.mock.calls[0][0].data.requestHash;
      prisma.idempotencyKey.findUnique.mockResolvedValue({ requestHash: storedHash, responseBody: storedResponse });

      const response = await request(app.getHttpServer())
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', 'k-6')
        .send(waterBody)
        .expect(201);
      expect(response.body.data).toEqual(JSON.parse(JSON.stringify(storedResponse)));
      expect(prisma.habit.create).toHaveBeenCalledTimes(1); // без дубля
    });
  });

  describe('GET /api/v1/habits', () => {
    it('returns a paginated list', async () => {
      prisma.habit.count.mockResolvedValue(1);
      prisma.habit.findMany.mockResolvedValue([storedHabit()]);
      const response = await request(app.getHttpServer())
        .get('/api/v1/habits')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(response.body.data).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(response.body.data.items[0]).toMatchObject({ id: 'h1', title: 'Пить воду' });
    });

    it('rejects an unknown status filter', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/habits?status=UNKNOWN')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });
  });

  describe('GET /api/v1/habits/:id', () => {
    it('returns 404 for another user habit (ownership)', async () => {
      prisma.habit.findFirst.mockResolvedValue(null);
      const response = await request(app.getHttpServer())
        .get('/api/v1/habits/h1')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
      expect(response.body.error.code).toBe('HABIT_NOT_FOUND');
      expect(prisma.habit.findFirst).toHaveBeenCalledWith({ where: { id: 'h1', userId: 'u' } });
    });
  });

  describe('PATCH /api/v1/habits/:id', () => {
    it('returns 409 HABIT_VERSION_CONFLICT on stale version', async () => {
      prisma.habit.findFirst.mockResolvedValue(storedHabit({ version: 5 }));
      const response = await request(app.getHttpServer())
        .patch('/api/v1/habits/h1')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', 'k-7')
        .send({ version: 4, title: 'Вода 2.5' })
        .expect(409);
      expect(response.body.error.code).toBe('HABIT_VERSION_CONFLICT');
    });

    it('updates habit with actual version', async () => {
      prisma.habit.findFirst.mockResolvedValueOnce(storedHabit()).mockResolvedValue(null);
      prisma.habit.update.mockImplementation(({ data }: any) =>
        Promise.resolve(storedHabit({ title: data.title, goalValue: data.goalValue, version: 2 })),
      );
      const response = await request(app.getHttpServer())
        .patch('/api/v1/habits/h1')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', 'k-8')
        .send({ version: 1, title: 'Вода 2.5', goalValue: 2500 })
        .expect(200);
      expect(response.body.data).toMatchObject({ title: 'Вода 2.5', goalValue: 2500, version: 2 });
    });
  });

  describe('pause / resume / archive', () => {
    it('full lifecycle: pause -> resume -> archive', async () => {
      prisma.habit.findFirst.mockResolvedValue(storedHabit());
      prisma.habit.update.mockImplementation(({ data }: any) => Promise.resolve(storedHabit({ status: data.status, version: 2 })));
      await request(app.getHttpServer())
        .post('/api/v1/habits/h1/pause')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', 'k-p')
        .expect(200)
        .expect((res) => expect(res.body.data.status).toBe('PAUSED'));

      prisma.habit.findFirst.mockResolvedValue(storedHabit({ status: 'PAUSED' }));
      await request(app.getHttpServer())
        .post('/api/v1/habits/h1/resume')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', 'k-r')
        .expect(200)
        .expect((res) => expect(res.body.data.status).toBe('ACTIVE'));

      await request(app.getHttpServer())
        .post('/api/v1/habits/h1/archive')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', 'k-a')
        .expect(200)
        .expect((res) => expect(res.body.data.status).toBe('ARCHIVED'));
    });

    it('returns 409 when pausing an archived habit', async () => {
      prisma.habit.findFirst.mockResolvedValue(storedHabit({ status: 'ARCHIVED' }));
      const response = await request(app.getHttpServer())
        .post('/api/v1/habits/h1/pause')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', 'k-pa')
        .expect(409);
      expect(response.body.error.code).toBe('HABIT_STATUS_INVALID');
    });
  });
});
