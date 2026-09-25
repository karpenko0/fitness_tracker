import { ConflictException } from '@nestjs/common';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { HabitCallbackService, TelegramCallbackUpdate } from './habit-callback.service';

describe('HabitCallbackService', () => {
  const today = new Date('2026-09-25T00:00:00Z');
  const prisma: any = {
    habitTask: { findFirst: jest.fn().mockResolvedValue(null) },
    idempotencyKey: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    $transaction: jest.fn(async (callback: any) => callback(prisma)),
  };
  const tasks: any = {
    updateProgress: jest.fn().mockResolvedValue({ id: 't1', status: 'COMPLETED', currentValue: 2000, version: 4 }),
  };
  const service = () => new HabitCallbackService(prisma, tasks, new IdempotencyService(prisma));

  const task = (overrides: Record<string, unknown> = {}, habitOverrides: Record<string, unknown> = {}) => ({
    id: 't1',
    habitId: 'h1',
    localDate: today,
    status: 'PENDING',
    currentValue: 0,
    version: 3,
    habit: {
      id: 'h1',
      userId: 'u',
      goalType: 'COUNT',
      goalValue: 2000,
      telegramChatId: '123',
      ...habitOverrides,
    },
    ...overrides,
  });

  const update = (overrides: Record<string, unknown> = {}): TelegramCallbackUpdate => ({
    callback_query: { id: 'cq1', from: { id: 123 }, data: 'habit_done:t1', ...overrides },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.habitTask.findFirst.mockResolvedValue(null);
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'ik', ...data, response: JSON.parse(data.responseBody) }),
    );
    tasks.updateProgress.mockResolvedValue({ id: 't1', status: 'COMPLETED', currentValue: 2000, version: 4 });
  });

  it('rejects callback data without the habit_done prefix', async () => {
    prisma.habitTask.findFirst.mockResolvedValue(task());
    await expect(service().handleCallback(update({ data: 'random:x' }))).rejects.toMatchObject({
      status: 400,
      response: { code: 'VALIDATION_ERROR' },
    });
  });

  it('rejects an update without callback_query.id', async () => {
    await expect(
      service().handleCallback({ callback_query: { from: { id: 123 }, data: 'habit_done:t1' } }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns 404 for an unknown task', async () => {
    await expect(service().handleCallback(update())).rejects.toMatchObject({
      status: 404,
      response: { code: 'HABIT_TASK_NOT_FOUND' },
    });
  });

  it('rejects a callback from another Telegram user (403) and does not touch progress', async () => {
    prisma.habitTask.findFirst.mockResolvedValue(task());
    await expect(service().handleCallback(update({ from: { id: 999 } }))).rejects.toMatchObject({
      status: 403,
      response: { code: 'TELEGRAM_CALLBACK_FORBIDDEN' },
    });
    expect(tasks.updateProgress).not.toHaveBeenCalled();
  });

  it('rejects a callback when the habit has no linked chat', async () => {
    prisma.habitTask.findFirst.mockResolvedValue(task({}, { telegramChatId: null }));
    await expect(service().handleCallback(update())).rejects.toMatchObject({ status: 403 });
  });

  it('completes a COUNT habit by SET to the goal with source TELEGRAM_CALLBACK', async () => {
    prisma.habitTask.findFirst.mockResolvedValue(task());
    const result = await service().handleCallback(update());
    expect(tasks.updateProgress).toHaveBeenCalledWith(
      'u',
      'h1',
      't1',
      { action: 'SET', value: 2000, version: 3 },
      'tg:cq1',
      'TELEGRAM_CALLBACK',
    );
    expect(result).toMatchObject({ ok: true, completed: true });
  });

  it('completes a BOOLEAN habit with SET without a value', async () => {
    prisma.habitTask.findFirst.mockResolvedValue(task({}, { goalType: 'BOOLEAN', goalValue: null }));
    await service().handleCallback(update());
    expect(tasks.updateProgress).toHaveBeenCalledWith('u', 'h1', 't1', { action: 'SET', version: 3 }, 'tg:cq1', 'TELEGRAM_CALLBACK');
  });

  it('answers alreadyDone without progress update when the task is already COMPLETED', async () => {
    prisma.habitTask.findFirst.mockResolvedValue(task({ status: 'COMPLETED' }));
    const result = await service().handleCallback(update());
    expect(result).toEqual({ ok: true, alreadyDone: true, taskId: 't1' });
    expect(tasks.updateProgress).not.toHaveBeenCalled();
  });

  it('uses the Telegram callback id as idempotency key so repeated callbacks dedupe', async () => {
    // Сам реплей обеспечивается IdempotencyService по ключу; здесь проверяем,
    // что повторный callback передаёт тот же ключ 'tg:<callback_query.id>'.
    prisma.habitTask.findFirst.mockResolvedValue(task());
    await service().handleCallback(update());
    await service().handleCallback(update());
    const keys = tasks.updateProgress.mock.calls.map((call: any[]) => call[4]);
    expect(keys).toEqual(['tg:cq1', 'tg:cq1']);
  });

  it('treats a TASK_ALREADY_CLOSED race as an idempotent success', async () => {
    prisma.habitTask.findFirst.mockResolvedValue(task());
    tasks.updateProgress.mockRejectedValue(
      new ConflictException({ code: 'TASK_ALREADY_CLOSED', message: 'Task is already completed, skipped or expired' }),
    );
    const result = await service().handleCallback(update());
    expect(result).toEqual({ ok: true, alreadyDone: true, taskId: 't1' });
  });

  it('does not complete a SKIPPED task and reports not-ok', async () => {
    prisma.habitTask.findFirst.mockResolvedValue(task({ status: 'SKIPPED' }));
    const result = await service().handleCallback(update());
    expect(result).toMatchObject({ ok: false });
    expect(tasks.updateProgress).not.toHaveBeenCalled();
  });
});
