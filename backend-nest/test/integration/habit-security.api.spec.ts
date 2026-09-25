// SPEC-009 Фаза 5: безопасность — 401 без токена, изоляция по владельцу, rate limiting (429).
// В отличие от остальных интеграционных spec, здесь НЕ переопределяется AuthGuard:
// используется реальный JwtStrategy, чтобы 401 проверялся честно.
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtStrategy } from '../../src/auth/strategies/jwt.strategy';
import { HabitController } from '../../src/habit/habit.controller';
import { HabitService } from '../../src/habit/habit.service';
import { HabitTaskService } from '../../src/habit/habit-task.service';
import { HabitLocalDateService } from '../../src/habit/habit-local-date.service';
import { HabitStreakService } from '../../src/habit/habit-streak.service';
import { HabitValidationService } from '../../src/habit/habit-validation.service';
import { IdempotencyService } from '../../src/common/services/idempotency.service';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

const JWT_SECRET = 'test-access-secret';

describe('Habit security API (integration)', () => {
  const prisma: any = {
    authSession: { findUnique: jest.fn().mockResolvedValue(null) },
    habit: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    habitTask: {
      upsert: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    habitTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    idempotencyKey: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
  };

  const config = { get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? JWT_SECRET : undefined) };
  const validToken = jwt.sign({ sub: 'u', sessionId: 's1', roles: ['USER'] }, JWT_SECRET, { expiresIn: '5m' });
  const auth = { Authorization: `Bearer ${validToken}` };

  const activeSession = () => ({
    userId: 'u',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: { status: 'ACTIVE' },
  });

  const habit = () => ({
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
    currentStreak: 0,
    bestStreak: 0,
    version: 1,
  });

  const buildApp = async (throttler?: { ttl: number; limit: number }): Promise<INestApplication> => {
    const moduleBuilder = Test.createTestingModule({
      imports: [PassportModule, ...(throttler ? [ThrottlerModule.forRoot([throttler])] : [])],
      controllers: [HabitController],
      providers: [
        HabitService,
        HabitTaskService,
        HabitStreakService,
        HabitLocalDateService,
        HabitValidationService,
        IdempotencyService,
        JwtStrategy,
        { provide: PrismaClient, useValue: prisma },
        { provide: ConfigService, useValue: config },
        ...(throttler ? [{ provide: APP_GUARD, useClass: ThrottlerGuard }] : []),
      ],
    });
    const app = (await moduleBuilder.compile()).createNestApplication();
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
    return app;
  };

  describe('authentication (401)', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await buildApp();
    });
    afterAll(async () => app.close());
    beforeEach(() => {
      jest.clearAllMocks();
      prisma.authSession.findUnique.mockResolvedValue(null);
    });

    it('GET /habits without a token → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/habits');
      expect(res.status).toBe(401);
    });

    it('POST /habits without a token → 401 (write route)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/habits')
        .set('Idempotency-Key', 'k1')
        .send({ title: 'x', type: 'WATER', goalType: 'COUNT', goalValue: 1, unit: 'ML', timezone: 'UTC', schedule: 'DAILY' });
      expect(res.status).toBe(401);
    });

    it('GET /habits/today with a garbage token → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/habits/today').set({ Authorization: 'Bearer not-a-jwt' });
      expect(res.status).toBe(401);
    });

    it('a valid token with a revoked session → 401', async () => {
      prisma.authSession.findUnique.mockResolvedValue({ ...activeSession(), revokedAt: new Date() });
      const res = await request(app.getHttpServer()).get('/api/v1/habits').set(auth);
      expect(res.status).toBe(401);
    });

    it('a valid token with an active session passes the guard', async () => {
      prisma.authSession.findUnique.mockResolvedValue(activeSession());
      const res = await request(app.getHttpServer()).get('/api/v1/habits').set(auth);
      expect(res.status).toBe(200);
    });
  });

  describe('ownership isolation', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await buildApp();
    });
    afterAll(async () => app.close());
    beforeEach(() => {
      jest.clearAllMocks();
      prisma.authSession.findUnique.mockResolvedValue(activeSession());
      prisma.habit.findFirst.mockResolvedValue(null);
      prisma.habitTask.findFirst.mockResolvedValue(null);
      prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    });

    it('GET /habits/:id scopes the query by the token userId → 404 for a foreign habit', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/habits/h-foreign').set(auth);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: expect.objectContaining({ code: 'HABIT_NOT_FOUND' }) });
      expect(prisma.habit.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'h-foreign', userId: 'u' }) }));
    });

    it('POST progress on a foreign task → 404 (task lookup is scoped by habit.userId)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/habits/h1/tasks/t-foreign/progress')
        .set({ ...auth, 'Idempotency-Key': 'k2' })
        .send({ action: 'ADD', value: 100, version: 1 });
      expect(res.status).toBe(404);
      expect(prisma.habitTask.findFirst).toHaveBeenCalledWith({
        where: { id: 't-foreign', habitId: 'h1', habit: { userId: 'u' } },
        include: { habit: true },
      });
    });

    it('GET /habits/today returns only the token owner habits', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/habits/today').set(auth);
      expect(res.status).toBe(200);
      expect(prisma.habit.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'u' }) }));
    });
  });

  describe('rate limiting (429)', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await buildApp({ ttl: 60_000, limit: 2 });
    });
    afterAll(async () => app.close());
    beforeEach(() => {
      prisma.authSession.findUnique.mockResolvedValue(activeSession());
      prisma.habit.findMany.mockResolvedValue([]);
    });

    it('the 3rd request within the window is rejected with 429', async () => {
      const get = () => request(app.getHttpServer()).get('/api/v1/habits').set(auth);
      expect((await get()).status).toBe(200);
      expect((await get()).status).toBe(200);
      const third = await get();
      expect(third.status).toBe(429);
    });
  });
});
