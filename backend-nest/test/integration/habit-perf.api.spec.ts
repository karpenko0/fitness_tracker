// SPEC-009 Фаза 5: производительность — p95 ≤ 300 мс для GET /habits/today и POST progress.
// Локальный замер handler-time in-process (без сети, БД на моках): сеть и СУБД не участвуют,
// поэтому это верхняя граница времени самого обработчика. Полный замер — scripts/load-smoke-habits.js
// на стенде с PostgreSQL.
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

describe('Habit performance (p95 handler-time, mocked DB)', () => {
  let app: INestApplication;
  const auth = { Authorization: 'Bearer test-token' };

  const prisma: any = {
    habit: {
      count: jest.fn().mockResolvedValue(1),
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

  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  // 10 привычек — типичная нагрузка на GET /today
  const habit = (i: number) => ({
    id: `h${i}`,
    userId: 'u',
    title: `Привычка ${i}`,
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
    habitStart: new Date('2026-09-01T00:00:00Z'),
    currentStreak: 3,
    bestStreak: 5,
    version: 1,
  });
  const task = (i: number) => ({
    id: `t${i}`,
    habitId: `h${i}`,
    localDate: today,
    status: 'PENDING',
    progressValue: 500,
    completedAt: null,
    skippedAt: null,
    expiredAt: null,
    version: 1,
    habit: habit(i),
  });

  const p95 = (times: number[]) => {
    const sorted = [...times].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HabitController],
      providers: [
        HabitService,
        HabitTaskService,
        HabitStreakService,
        HabitLocalDateService,
        HabitValidationService,
        IdempotencyService,
        { provide: PrismaClient, useValue: prisma },
      ],
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

  it('GET /habits/today: p95 ≤ 300 мс (10 привычек, 300 запросов)', async () => {
    prisma.habit.findMany.mockResolvedValue([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(habit));
    prisma.habitTask.upsert.mockImplementation(({ create }: any) => Promise.resolve({ id: create.habitId.replace('h', 't'), ...create, progressValue: 500, version: 1, habit: habit(0) }));
    prisma.habitTask.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve([task(Number(String(where.habitId ?? 'h0').slice(1)))]),
    );

    // прогрев
    for (let i = 0; i < 10; i++) await request(app.getHttpServer()).get('/api/v1/habits/today').set(auth).expect(200);

    const times: number[] = [];
    for (let i = 0; i < 300; i++) {
      const started = process.hrtime.bigint();
      const res = await request(app.getHttpServer()).get('/api/v1/habits/today').set(auth);
      times.push(Number(process.hrtime.bigint() - started) / 1e6);
      expect(res.status).toBe(200);
    }
    const result = p95(times);
    // eslint-disable-next-line no-console
    console.log(`[perf] GET /habits/today p95=${result.toFixed(1)} ms`);
    expect(result).toBeLessThanOrEqual(300);
  });

  it('POST progress: p95 ≤ 300 мс (300 запросов)', async () => {
    prisma.habitTask.findFirst.mockImplementation(() => Promise.resolve(task(0)));
    prisma.habitTask.update.mockImplementation(({ data }: any) => Promise.resolve({ ...task(0), ...data, version: 2 }));
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'ik', ...data }));

    let seq = 0;
    const times: number[] = [];
    for (let i = 0; i < 300; i++) {
      const started = process.hrtime.bigint();
      const res = await request(app.getHttpServer())
        .post('/api/v1/habits/h0/tasks/t0/progress')
        .set({ ...auth, 'Idempotency-Key': `perf-${seq++}` })
        .send({ action: 'ADD', value: 100, version: 1 });
      times.push(Number(process.hrtime.bigint() - started) / 1e6);
      expect(res.status).toBe(201); // @Post без @HttpCode — 201, как в habit-tasks.api.spec
    }
    const result = p95(times);
    // eslint-disable-next-line no-console
    console.log(`[perf] POST progress p95=${result.toFixed(1)} ms`);
    expect(result).toBeLessThanOrEqual(300);
  });
});
