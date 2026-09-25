// SPEC-009 Фаза 6: E2E-сценарии №1–10 поверх полного HTTP-слоя (оба контроллера,
// все сервисы, реальные пайпы/фильтры) c stateful in-memory Prisma.
// Telegram — мок TelegramBotClient; даты, требующие управления временем,
// прогоняются через production-сервисы с явным `now`.
import { INestApplication, ValidationPipe, BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { HabitController } from '../../src/habit/habit.controller';
import { HabitService } from '../../src/habit/habit.service';
import { HabitTaskService } from '../../src/habit/habit-task.service';
import { HabitStreakService } from '../../src/habit/habit-streak.service';
import { HabitLocalDateService } from '../../src/habit/habit-local-date.service';
import { HabitValidationService } from '../../src/habit/habit-validation.service';
import { HabitNotificationService } from '../../src/habit/telegram/habit-notification.service';
import { HabitCallbackService } from '../../src/habit/telegram/habit-callback.service';
import { TelegramBotClient } from '../../src/habit/telegram/telegram-bot.client';
import { IdempotencyService } from '../../src/common/services/idempotency.service';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { createMemoryPrisma } from '../helpers/memory-prisma';

describe('Habit E2E scenarios (SPEC-009 §16)', () => {
  let app: INestApplication;
  let mem: ReturnType<typeof createMemoryPrisma>;
  let tasks: HabitTaskService;
  let streaks: HabitStreakService;
  let notifications: HabitNotificationService;
  let telegram: { sendMessage: jest.Mock };

  const auth = { Authorization: 'Bearer test-token' };
  let keySeq = 0;
  const key = () => `e2e-${++keySeq}`;

  const utcMidnight = (d: Date) => new Date(d.toISOString().slice(0, 10) + 'T00:00:00Z');
  const today = utcMidnight(new Date());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const monday = new Date('2026-09-21T12:00:00Z'); // понедельник
  const tuesday = new Date('2026-09-22T12:00:00Z');
  const wednesday = new Date('2026-09-23T12:00:00Z');

  const createHabit = async (body: Record<string, unknown>) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/habits')
      .set({ ...auth, 'Idempotency-Key': key() })
      .send(body)
      .expect(201);
    return res.body.data;
  };

  const getTodayTask = async (habitId: string) => {
    const res = await request(app.getHttpServer()).get('/api/v1/habits/today').set(auth).expect(200);
    const item = res.body.data.items.find((i: any) => i.habit.id === habitId);
    return item?.task ?? null;
  };

  const addProgress = (habitId: string, taskId: string, value: number, version: number) =>
    request(app.getHttpServer())
      .post(`/api/v1/habits/${habitId}/tasks/${taskId}/progress`)
      .set({ ...auth, 'Idempotency-Key': key() })
      .send({ action: 'ADD', value, version });

  beforeAll(async () => {
    mem = createMemoryPrisma();
    telegram = { sendMessage: jest.fn().mockResolvedValue({ ok: true, messageId: 1 }) };
    const module = await Test.createTestingModule({
      controllers: [HabitController, (await import('../../src/habit/telegram/habit-callback.controller')).HabitCallbackController],
      providers: [
        HabitService,
        HabitTaskService,
        HabitStreakService,
        HabitLocalDateService,
        HabitValidationService,
        HabitNotificationService,
        HabitCallbackService,
        IdempotencyService,
        { provide: TelegramBotClient, useValue: telegram },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: PrismaClient, useValue: mem.prisma },
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

    tasks = module.get(HabitTaskService);
    streaks = module.get(HabitStreakService);
    notifications = module.get(HabitNotificationService);
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    for (const rows of Object.values(mem.store)) rows.length = 0;
    mem.store.user.push({ id: 'u', notificationsDisabled: false, createdAt: new Date(), updatedAt: new Date() });
    telegram.sendMessage.mockClear();
    telegram.sendMessage.mockResolvedValue({ ok: true, messageId: 1 });
  });

  it('сценарий 1: «Вода» — создать → +250 мл ×8 → цель → COMPLETED, streak +1', async () => {
    const habit = await createHabit({
      title: 'Пить воду', type: 'WATER', goalType: 'COUNT', goalValue: 2000, unit: 'ML', schedule: 'DAILY', timezone: 'UTC',
    });

    let task = await getTodayTask(habit.id);
    expect(task).toMatchObject({ status: 'PENDING' });

    for (let i = 0; i < 8; i++) {
      const res = await addProgress(habit.id, task.id, 250, task.version).expect(201);
      task = res.body.data;
      if (i < 7) expect(task.status).toBe('PENDING');
    }
    expect(task).toMatchObject({ status: 'COMPLETED', progressValue: 2000 });

    const res = await request(app.getHttpServer()).get(`/api/v1/habits/${habit.id}`).set(auth).expect(200);
    expect(res.body.data).toMatchObject({ currentStreak: 1, bestStreak: 1 });
  });

  it('сценарий 2: «Шаги» ПН/СР/ПТ — вторник не рвёт streak', async () => {
    const habit = await createHabit({
      title: '10000 шагов', type: 'STEPS', goalType: 'COUNT', goalValue: 10000, unit: 'STEPS',
      schedule: 'WEEKDAYS', weekdays: [1, 3, 5], timezone: 'UTC',
    });
    // привычка «существует» с начала недели — иначе граница habitStart (createdAt) отсечёт прошлые дни
    await mem.prisma.habit.update({ where: { id: habit.id }, data: { createdAt: new Date('2026-09-14T00:00:00Z') } });

    const completeOn = async (when: Date) => {
      const task = await tasks.ensureTaskForHabit({ ...habit, id: habit.id }, when);
      expect(task).not.toBeNull();
      await mem.prisma.habitTask.update({
        where: { id: task!.id },
        data: { status: 'COMPLETED', progressValue: 10000, completedAt: when },
      });
      await streaks.recalcForHabit(habit.id, mem.prisma, when);
    };

    await completeOn(monday);
    expect((await mem.prisma.habit.findUnique({ where: { id: habit.id } })).currentStreak).toBe(1);

    // Вторник не входит в расписание — streak не рвётся
    await streaks.recalcForHabit(habit.id, mem.prisma, tuesday);
    expect((await mem.prisma.habit.findUnique({ where: { id: habit.id } })).currentStreak).toBe(1);

    await completeOn(wednesday);
    const stored = await mem.prisma.habit.findUnique({ where: { id: habit.id } });
    expect(stored.currentStreak).toBe(2);
    expect(stored.bestStreak).toBe(2);
  });

  it('сценарий 3: «Растяжка» — напоминание в Telegram → callback «Отметить выполненной»', async () => {
    const habit = await createHabit({
      title: 'Растяжка', type: 'STRETCHING', goalType: 'BOOLEAN', schedule: 'DAILY', timezone: 'UTC',
      reminderTime: '10:00', telegramChatId: '123',
    });
    const task = await getTodayTask(habit.id);

    const now = new Date(new Date().toISOString().slice(0, 11) + '10:05:00Z'); // 10:05 UTC — после 10:00
    await notifications.ensureScheduledNotifications(now);
    const result = await notifications.sendDueNotifications(now);
    expect(result.sent).toBe(1);
    expect(telegram.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('Растяжка'));

    const cb = await request(app.getHttpServer())
      .post('/api/v1/telegram/habits/callback')
      .send({ callback_query: { id: 'cq-e2e-1', from: { id: 123 }, data: `habit_done:${task.id}` } })
      .expect(200);
    expect(cb.body.data).toMatchObject({ ok: true, completed: true });

    const after = await getTodayTask(habit.id);
    expect(after).toMatchObject({ status: 'COMPLETED' });
  });

  it('сценарий 4: MEDICATION — нейтральный текст уведомления (без препарата и дозировки)', async () => {
    const habit = await createHabit({
      title: 'Витамин D3 5000 МЕ', type: 'MEDICATION', goalType: 'BOOLEAN', schedule: 'DAILY', timezone: 'UTC',
      reminderTime: '09:00', telegramChatId: '123',
    });
    await getTodayTask(habit.id);

    const now = new Date(new Date().toISOString().slice(0, 11) + '09:30:00Z');
    await notifications.ensureScheduledNotifications(now);
    await notifications.sendDueNotifications(now);

    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const text: string = telegram.sendMessage.mock.calls[0][1];
    expect(text).toBe('⏰ Пора отметить выполнение привычки');
    expect(text).not.toContain('Витамин');
    expect(text).not.toContain('5000');
    expect(text).not.toContain('МЕ');
  });

  it('сценарий 5: Skip → streak сброшен, bestStreak сохранён', async () => {
    const habit = await createHabit({
      title: 'Зарядка', type: 'STRETCHING', goalType: 'BOOLEAN', schedule: 'DAILY', timezone: 'UTC',
    });
    await mem.prisma.habit.update({ where: { id: habit.id }, data: { createdAt: new Date(Date.now() - 7 * 86_400_000) } });

    // Вчера выполнено → streak 1
    const yesterdayTask = await tasks.ensureTaskForHabit({ ...habit }, new Date(yesterday.getTime() + 43_200_000));
    await mem.prisma.habitTask.update({
      where: { id: yesterdayTask!.id },
      data: { status: 'COMPLETED', completedAt: yesterday },
    });
    await streaks.recalcForHabit(habit.id, mem.prisma, new Date(yesterday.getTime() + 43_200_000));
    expect((await mem.prisma.habit.findUnique({ where: { id: habit.id } })).currentStreak).toBe(1);

    // Сегодня пропуск через HTTP
    const task = await getTodayTask(habit.id);
    await request(app.getHttpServer())
      .post(`/api/v1/habits/${habit.id}/tasks/${task.id}/skip`)
      .set({ ...auth, 'Idempotency-Key': key() })
      .send({ version: task.version })
      .expect(201);

    const res = await request(app.getHttpServer()).get(`/api/v1/habits/${habit.id}`).set(auth).expect(200);
    expect(res.body.data).toMatchObject({ currentStreak: 0, bestStreak: 1 });
  });

  it('сценарий 6: не выполнил до конца локального дня → EXPIRED', async () => {
    const habit = await createHabit({
      title: 'Прогулка', type: 'STEPS', goalType: 'COUNT', goalValue: 5000, unit: 'STEPS', schedule: 'DAILY', timezone: 'UTC',
    });
    const stale = await tasks.ensureTaskForHabit({ ...habit }, new Date(yesterday.getTime() + 43_200_000));

    const expired = await tasks.expireOverdueTasks(new Date());
    expect(expired).toBeGreaterThanOrEqual(1);

    const stored = await mem.prisma.habitTask.findUnique({ where: { habitId_localDate: { habitId: habit.id, localDate: yesterday } } });
    expect(stored.status).toBe('EXPIRED');
    expect(stored.expiredAt).not.toBeNull();
    expect(stale!.id).toBe(stored.id);
  });

  it('сценарий 7: Пауза → нет новых заданий и уведомлений', async () => {
    const habit = await createHabit({
      title: 'Медитация', type: 'CUSTOM', goalType: 'BOOLEAN', schedule: 'DAILY', timezone: 'UTC',
      reminderTime: '08:00', telegramChatId: '123',
    });

    await request(app.getHttpServer())
      .post(`/api/v1/habits/${habit.id}/pause`)
      .set({ ...auth, 'Idempotency-Key': key() })
      .send({ version: habit.version })
      .expect(200);

    // Задание, созданное при создании привычки (до паузы), остаётся единственным — новых не генерируется
    expect(mem.store.habitTask.filter((t) => t.habitId === habit.id)).toHaveLength(1);
    const generated = await tasks.generateForAllActiveHabits(new Date());
    expect(generated).toBe(0);
    expect(mem.store.habitTask.filter((t) => t.habitId === habit.id)).toHaveLength(1);

    // Уведомления не планируются и не отправляются
    await notifications.ensureScheduledNotifications(new Date());
    expect(mem.store.habitNotification.filter((n) => n.habitId === habit.id)).toHaveLength(0);

    // В /today привычка есть, новое задание для паузированной не создаётся
    const res = await request(app.getHttpServer()).get('/api/v1/habits/today').set(auth).expect(200);
    const item = res.body.data.items.find((i: any) => i.habit.id === habit.id);
    expect(item.habit.status).toBe('PAUSED');
  });

  it('сценарий 8: Блокировка бота → уведомления пользователя отключены, статусы не меняются', async () => {
    const habit = await createHabit({
      title: 'Отжимания', type: 'CUSTOM', goalType: 'COUNT', goalValue: 50, unit: 'TIMES', schedule: 'DAILY', timezone: 'UTC',
      reminderTime: '07:00', telegramChatId: '123',
    });
    const task = await getTodayTask(habit.id);

    telegram.sendMessage.mockResolvedValue({ ok: false, kind: 'blocked', message: 'Forbidden: bot was blocked by the user' });
    const now = new Date(new Date().toISOString().slice(0, 11) + '07:30:00Z');
    await notifications.ensureScheduledNotifications(now);
    const result = await notifications.sendDueNotifications(now);
    expect(result.blocked).toBe(1);

    expect(mem.store.user[0].notificationsDisabled).toBe(true);
    const notification = mem.store.habitNotification.find((n) => n.habitId === habit.id)!;
    expect(notification).toMatchObject({ status: 'FAILED', lastError: 'BOT_BLOCKED' });

    // Статусы привычки и задания не изменились
    expect((await mem.prisma.habit.findUnique({ where: { id: habit.id } })).status).toBe('ACTIVE');
    expect((await mem.prisma.habitTask.findUnique({ where: { habitId_localDate: { habitId: habit.id, localDate: today } } })).status).toBe('PENDING');
    expect(task.status).toBe('PENDING');
  });

  it('сценарий 9: Два параллельных progress-запроса → нет двойного прогресса', async () => {
    const habit = await createHabit({
      title: 'Приседания', type: 'CUSTOM', goalType: 'COUNT', goalValue: 2000, unit: 'TIMES', schedule: 'DAILY', timezone: 'UTC',
    });
    const task = await getTodayTask(habit.id);

    const [a, b] = await Promise.all([
      addProgress(habit.id, task.id, 100, task.version),
      addProgress(habit.id, task.id, 100, task.version),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = a.status === 409 ? a : b;
    expect(conflict.body.error.code).toBe('HABIT_TASK_VERSION_CONFLICT');

    const stored = await mem.prisma.habitTask.findUnique({ where: { habitId_localDate: { habitId: habit.id, localDate: today } } });
    expect(stored.progressValue).toBe(100); // один инкремент, не два
    expect(stored.version).toBe(task.version + 1);
  });

  it('сценарий 10: Чужая привычка → отказ доступа', async () => {
    // Привычка и задание другого пользователя — напрямую в хранилище
    const foreign = await mem.prisma.habit.create({
      data: { userId: 'other', title: 'Чужая', type: 'WATER', goalType: 'COUNT', goalValue: 1000, unit: 'ML', schedule: 'DAILY', timezone: 'UTC', status: 'ACTIVE' },
    });
    const foreignTask = await mem.prisma.habitTask.create({ data: { habitId: foreign.id, localDate: today, status: 'PENDING' } });

    const get = await request(app.getHttpServer()).get(`/api/v1/habits/${foreign.id}`).set(auth);
    expect(get.status).toBe(404);

    const progress = await addProgress(foreign.id, foreignTask.id, 100, 1);
    expect(progress.status).toBe(404);

    const list = await request(app.getHttpServer()).get('/api/v1/habits').set(auth).expect(200);
    expect(list.body.data.items.some((h: any) => h.id === foreign.id)).toBe(false);

    const cb = await request(app.getHttpServer())
      .post('/api/v1/telegram/habits/callback')
      .send({ callback_query: { id: 'cq-foreign', from: { id: 555 }, data: `habit_done:${foreignTask.id}` } });
    expect(cb.status).toBe(403);
  });
});
