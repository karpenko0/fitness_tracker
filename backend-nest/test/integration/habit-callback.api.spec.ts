// SPEC-009 integration: webhook Telegram callback «Отметить выполненной».
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { HabitCallbackController } from '../../src/habit/telegram/habit-callback.controller';
import { HabitCallbackService } from '../../src/habit/telegram/habit-callback.service';
import { HabitTaskService } from '../../src/habit/habit-task.service';
import { HabitStreakService } from '../../src/habit/habit-streak.service';
import { HabitLocalDateService } from '../../src/habit/habit-local-date.service';
import { IdempotencyService } from '../../src/common/services/idempotency.service';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

describe('Habit Telegram callback API (integration)', () => {
  let app: INestApplication;
  const SECRET = 'test-webhook-secret';
  const secretHeader = { 'x-telegram-bot-api-secret-token': SECRET };

  const prisma: any = {
    habitTask: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    habit: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    habitTaskEvent: { create: jest.fn().mockResolvedValue({}) },
    idempotencyKey: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
  };

  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'); // сегодняшняя UTC-дата
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
    telegramChatId: '123',
    status: 'ACTIVE',
    habitStart: new Date('2026-09-20T00:00:00Z'),
    currentStreak: 0,
    bestStreak: 0,
    version: 1,
    ...overrides,
  });
  const task = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    habitId: 'h1',
    localDate: today,
    status: 'PENDING',
    progressValue: 0,
    completedAt: null,
    skippedAt: null,
    expiredAt: null,
    version: 3,
    habit: habit(),
    ...overrides,
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HabitCallbackController],
      providers: [
        HabitCallbackService,
        HabitTaskService,
        HabitStreakService,
        HabitLocalDateService,
        IdempotencyService,
        { provide: PrismaClient, useValue: prisma },
        { provide: ConfigService, useValue: { get: (key: string) => (key === 'TELEGRAM_WEBHOOK_SECRET' ? SECRET : undefined) } },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({ canActivate: () => true }) // webhook не использует JWT
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.habitTask.findFirst.mockResolvedValue(null);
    prisma.habitTask.findMany.mockResolvedValue([]);
    prisma.habit.findUnique.mockResolvedValue(null);
    prisma.habit.update.mockResolvedValue({});
    prisma.habitTask.update.mockImplementation(({ data }: any) => Promise.resolve({ ...task(), ...data, version: 4 }));
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'ik', ...data }));
  });

  const post = (body: Record<string, unknown>, headers: Record<string, string> = secretHeader) =>
    request(app.getHttpServer()).post('/api/v1/telegram/habits/callback').set(headers).send(body as object);

  it('rejects a webhook without the valid secret with 403', async () => {
    const res = await post({ callback_query: { id: 'cq1', from: { id: 123 }, data: 'habit_done:t1' } }, {});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: expect.objectContaining({ code: 'WEBHOOK_SECRET_INVALID' }) });
    expect(prisma.habitTask.update).not.toHaveBeenCalled();
  });

  it('completes the task via callback and answers 200', async () => {
    prisma.habitTask.findFirst.mockResolvedValue(task());
    const res = await post({ callback_query: { id: 'cq1', from: { id: 123 }, data: 'habit_done:t1' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ok: true, completed: true, taskId: 't1' } });
    expect(prisma.habitTask.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({ status: 'COMPLETED', progressValue: 2000 }),
    });
    expect(prisma.habitTaskEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ taskId: 't1', action: 'SET', source: 'TELEGRAM_CALLBACK' }),
    });
  });

  it('answers 403 for a callback from another Telegram user', async () => {
    prisma.habitTask.findFirst.mockResolvedValue(task());
    const res = await post({ callback_query: { id: 'cq2', from: { id: 777 }, data: 'habit_done:t1' } });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: expect.objectContaining({ code: 'TELEGRAM_CALLBACK_FORBIDDEN' }) });
    expect(prisma.habitTask.update).not.toHaveBeenCalled();
  });

  it('returns 400 for an unsupported callback payload', async () => {
    const res = await post({ callback_query: { id: 'cq3', from: { id: 123 }, data: 'unknown:x' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.objectContaining({ code: 'VALIDATION_ERROR' }) });
  });

  it('a repeated callback is idempotent (single progress update)', async () => {
    prisma.habitTask.findFirst.mockResolvedValue(task());
    const body = { callback_query: { id: 'cq4', from: { id: 123 }, data: 'habit_done:t1' } };
    const first = await post(body);
    const stored = prisma.idempotencyKey.create.mock.calls[0][0].data;
    prisma.idempotencyKey.findUnique.mockResolvedValue({ ...stored });
    const second = await post(body);
    expect(second.body).toEqual(first.body);
    expect(prisma.habitTask.update).toHaveBeenCalledTimes(1);
  });

  it('reports 404 for an unknown task', async () => {
    const res = await post({ callback_query: { id: 'cq5', from: { id: 123 }, data: 'habit_done:nope' } });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.objectContaining({ code: 'HABIT_TASK_NOT_FOUND' }) });
  });

  it('treats a TASK_ALREADY_CLOSED race as 200 alreadyDone', async () => {
    // Первая выборка (callback) видит PENDING, повторная внутри updateProgress — уже SKIPPED
    prisma.habitTask.findFirst
      .mockResolvedValueOnce(task())
      .mockResolvedValueOnce(task({ status: 'SKIPPED', skippedAt: new Date() }));
    const res = await post({ callback_query: { id: 'cq6', from: { id: 123 }, data: 'habit_done:t1' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { ok: true, alreadyDone: true, taskId: 't1' } });
    expect(prisma.habitTask.update).not.toHaveBeenCalled();
  });
});
