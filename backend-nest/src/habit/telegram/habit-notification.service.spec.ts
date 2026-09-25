import { HabitLocalDateService } from '../habit-local-date.service';
import { HabitNotificationService, MAX_RETRIES } from './habit-notification.service';

describe('HabitNotificationService', () => {
  // Пятница, 25.09.2026, 09:35 UTC = 12:35 в Москве
  const now = new Date('2026-09-25T09:35:00Z');
  const today = new Date('2026-09-25T00:00:00Z');

  const prisma: any = {
    habit: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    habitTask: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    habitNotification: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: { update: jest.fn() },
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  const telegram: any = { sendMessage: jest.fn() };

  const service = () => new HabitNotificationService(prisma, new HabitLocalDateService(), telegram);

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
    timezone: 'Europe/Moscow',
    reminderTime: '12:30',
    telegramChatId: '123',
    status: 'ACTIVE',
    user: { id: 'u', notificationsDisabled: false },
    ...overrides,
  });

  const pendingTask = { id: 't1', habitId: 'h1', localDate: today, status: 'PENDING' };

  const notification = (overrides: Record<string, unknown> = {}) => ({
    id: 'n1',
    habitId: 'h1',
    taskLocalDate: today,
    kind: 'DAILY_REMINDER',
    status: 'SCHEDULED',
    attempts: 0,
    lastError: null,
    habit: habit(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.habit.findMany.mockResolvedValue([]);
    prisma.habitTask.findUnique.mockResolvedValue(null);
    prisma.habitNotification.findMany.mockResolvedValue([]);
    prisma.habitNotification.findUnique.mockResolvedValue(null);
    prisma.habitNotification.create.mockResolvedValue({ id: 'n1' });
    prisma.habitNotification.update.mockResolvedValue({});
  });

  describe('buildReminderText', () => {
    it('includes the title for ordinary habits', () => {
      expect(service().buildReminderText({ type: 'WATER', title: 'Пить воду' })).toContain('Пить воду');
    });

    it('is neutral for MEDICATION: no title, no dosage, no medical data', () => {
      const text = service().buildReminderText({ type: 'MEDICATION', title: 'Витамин D3 5000 МЕ утром' });
      expect(text).not.toContain('Витамин');
      expect(text).not.toContain('5000');
      expect(text).not.toContain('МЕ');
      expect(text).toBe('⏰ Пора отметить выполнение привычки');
    });
  });

  describe('ensureScheduledNotifications', () => {
    it('schedules a reminder for an active habit with a pending task', async () => {
      prisma.habit.findMany.mockResolvedValue([habit()]);
      prisma.habitTask.findUnique.mockResolvedValue(pendingTask);
      const created = await service().ensureScheduledNotifications(now);
      expect(created).toBe(1);
      expect(prisma.habitNotification.findUnique).toHaveBeenCalledWith({
        where: { habitId_taskLocalDate_kind: { habitId: 'h1', taskLocalDate: today, kind: 'DAILY_REMINDER' } },
      });
      expect(prisma.habitNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ habitId: 'h1', kind: 'DAILY_REMINDER', status: 'SCHEDULED' }),
      });
    });

    it('does not create a duplicate when the notification already exists', async () => {
      prisma.habit.findMany.mockResolvedValue([habit()]);
      prisma.habitTask.findUnique.mockResolvedValue(pendingTask);
      prisma.habitNotification.findUnique.mockResolvedValue({ id: 'n1', status: 'SENT' });
      const created = await service().ensureScheduledNotifications(now);
      expect(created).toBe(0);
      expect(prisma.habitNotification.create).not.toHaveBeenCalled();
    });

    it('does not schedule for a completed task', async () => {
      prisma.habit.findMany.mockResolvedValue([habit()]);
      prisma.habitTask.findUnique.mockResolvedValue({ ...pendingTask, status: 'COMPLETED' });
      const created = await service().ensureScheduledNotifications(now);
      expect(created).toBe(0);
      expect(prisma.habitNotification.create).not.toHaveBeenCalled();
    });

    it('selects only active habits with reminder time, chat id and enabled notifications', async () => {
      await service().ensureScheduledNotifications(now);
      expect(prisma.habit.findMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          reminderTime: { not: null },
          telegramChatId: { not: null },
          user: { notificationsDisabled: false },
        },
      });
    });
  });

  describe('isDue', () => {
    it('is due at the reminder time in the habit timezone, not UTC', () => {
      const svc = service();
      // 12:35 MSK > 12:30 — пора
      expect(svc.isDue(habit(), today, now)).toBe(true);
      // 12:25 MSK — ещё рано
      expect(svc.isDue(habit(), today, new Date('2026-09-25T09:25:00Z'))).toBe(false);
      // другой локальный день — не пора
      expect(svc.isDue(habit(), new Date('2026-09-24T00:00:00Z'), now)).toBe(false);
    });
  });

  describe('sendDueNotifications', () => {
    it('sends a due reminder and marks it SENT', async () => {
      prisma.habitNotification.findMany.mockResolvedValue([notification()]);
      prisma.habitTask.findUnique.mockResolvedValue(pendingTask);
      telegram.sendMessage.mockResolvedValue({ ok: true, messageId: 7 });
      const result = await service().sendDueNotifications(now);
      expect(result.sent).toBe(1);
      expect(telegram.sendMessage).toHaveBeenCalledWith('123', expect.stringContaining('Пить воду'));
      expect(prisma.habitNotification.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }),
      );
    });

    it('does not send before the reminder time', async () => {
      prisma.habitNotification.findMany.mockResolvedValue([notification()]);
      prisma.habitTask.findUnique.mockResolvedValue(pendingTask);
      const result = await service().sendDueNotifications(new Date('2026-09-25T09:25:00Z')); // 12:25 MSK
      expect(telegram.sendMessage).not.toHaveBeenCalled();
      expect(result.sent).toBe(0);
    });

    it('cancels and does not send for a completed task', async () => {
      prisma.habitNotification.findMany.mockResolvedValue([notification()]);
      prisma.habitTask.findUnique.mockResolvedValue({ ...pendingTask, status: 'COMPLETED' });
      await service().sendDueNotifications(now);
      expect(telegram.sendMessage).not.toHaveBeenCalled();
      expect(prisma.habitNotification.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
    });

    it('does not send for a paused habit but keeps the notification', async () => {
      prisma.habitNotification.findMany.mockResolvedValue([notification({ habit: habit({ status: 'PAUSED' }) })]);
      await service().sendDueNotifications(now);
      expect(telegram.sendMessage).not.toHaveBeenCalled();
      expect(prisma.habitNotification.update).not.toHaveBeenCalled();
    });

    it('cancels notifications of an archived habit', async () => {
      prisma.habitNotification.findMany.mockResolvedValue([notification({ habit: habit({ status: 'ARCHIVED' }) })]);
      await service().sendDueNotifications(now);
      expect(telegram.sendMessage).not.toHaveBeenCalled();
      expect(prisma.habitNotification.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
    });

    it('does not send when user notifications are disabled', async () => {
      prisma.habitNotification.findMany.mockResolvedValue([
        notification({ habit: habit({ user: { id: 'u', notificationsDisabled: true } }) }),
      ]);
      await service().sendDueNotifications(now);
      expect(telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('retries a transient error and keeps SCHEDULED', async () => {
      prisma.habitNotification.findMany.mockResolvedValue([notification({ attempts: 0 })]);
      prisma.habitTask.findUnique.mockResolvedValue(pendingTask);
      telegram.sendMessage.mockResolvedValue({ ok: false, kind: 'retry', message: 'Too Many Requests' });
      const result = await service().sendDueNotifications(now);
      expect(result.retried).toBe(1);
      expect(prisma.habitNotification.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SCHEDULED', attempts: 1 }) }),
      );
    });

    it('performs no more than three retries then marks FAILED', async () => {
      // attempts=3 — исчерпан лимат retry (1 первая попытка + 3 retry)
      prisma.habitNotification.findMany.mockResolvedValue([notification({ attempts: MAX_RETRIES })]);
      prisma.habitTask.findUnique.mockResolvedValue(pendingTask);
      telegram.sendMessage.mockResolvedValue({ ok: false, kind: 'retry', message: 'still failing' });
      const result = await service().sendDueNotifications(now);
      expect(result.failed).toBe(1);
      expect(prisma.habitNotification.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', attempts: MAX_RETRIES + 1 }) }),
      );
      // следующая выборка его уже не возьмёт: attempts >= MAX_SEND_ATTEMPTS
      expect(prisma.habitNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ attempts: { lt: MAX_RETRIES + 1 } }) }),
      );
    });

    it('disables user notifications when the bot is blocked and leaves habit/task untouched', async () => {
      prisma.habitNotification.findMany.mockResolvedValue([notification()]);
      prisma.habitTask.findUnique.mockResolvedValue(pendingTask);
      telegram.sendMessage.mockResolvedValue({ ok: false, kind: 'blocked', message: 'Forbidden: bot was blocked' });
      const result = await service().sendDueNotifications(now);
      expect(result.blocked).toBe(1);
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u' }, data: { notificationsDisabled: true } });
      expect(prisma.habitNotification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ habit: { userId: 'u' }, status: 'SCHEDULED' }) , data: { status: 'CANCELLED' } }),
      );
      // статусы привычки и задания не меняются
      expect(prisma.habit.update).not.toHaveBeenCalled();
      expect(prisma.habitTask.update).not.toHaveBeenCalled();
    });

    it('never re-sends: only SCHEDULED/FAILED with attempts left are selected', async () => {
      await service().sendDueNotifications(now);
      expect(prisma.habitNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: { in: ['SCHEDULED', 'FAILED'] } }) }),
      );
    });

    it('a delivery error does not change habit or task status', async () => {
      prisma.habitNotification.findMany.mockResolvedValue([notification()]);
      prisma.habitTask.findUnique.mockResolvedValue(pendingTask);
      telegram.sendMessage.mockResolvedValue({ ok: false, kind: 'retry', message: 'timeout' });
      await service().sendDueNotifications(now);
      expect(prisma.habit.update).not.toHaveBeenCalled();
      expect(prisma.habitTask.update).not.toHaveBeenCalled();
    });
  });
});
