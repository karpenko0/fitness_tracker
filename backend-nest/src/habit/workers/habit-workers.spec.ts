import { HabitExpireWorker } from './habit-expire.worker';
import { HabitReminderWorker } from './habit-reminder.worker';
import { HabitTaskGenerationWorker } from './habit-task-generation.worker';

describe('Habit workers', () => {
  it('generation worker delegates to HabitTaskService and swallows errors', async () => {
    const tasks: any = { generateForAllActiveHabits: jest.fn().mockResolvedValue(3) };
    const worker = new HabitTaskGenerationWorker(tasks);
    await worker.handleCron();
    expect(tasks.generateForAllActiveHabits).toHaveBeenCalledTimes(1);

    tasks.generateForAllActiveHabits.mockRejectedValue(new Error('db down'));
    await expect(worker.handleCron()).resolves.toBeUndefined(); // воркер не роняет процесс
  });

  it('expire worker delegates to HabitTaskService and swallows errors', async () => {
    const tasks: any = { expireOverdueTasks: jest.fn().mockResolvedValue(2) };
    const worker = new HabitExpireWorker(tasks);
    await worker.handleCron();
    expect(tasks.expireOverdueTasks).toHaveBeenCalledTimes(1);

    tasks.expireOverdueTasks.mockRejectedValue(new Error('db down'));
    await expect(worker.handleCron()).resolves.toBeUndefined();
  });

  it('reminder worker schedules and sends notifications, swallowing errors', async () => {
    const notifications: any = {
      ensureScheduledNotifications: jest.fn().mockResolvedValue(1),
      sendDueNotifications: jest.fn().mockResolvedValue({ sent: 1, retried: 0, failed: 0, blocked: 0 }),
    };
    const worker = new HabitReminderWorker(notifications);
    await worker.handleCron();
    expect(notifications.ensureScheduledNotifications).toHaveBeenCalledTimes(1);
    expect(notifications.sendDueNotifications).toHaveBeenCalledTimes(1);

    notifications.sendDueNotifications.mockRejectedValue(new Error('telegram down'));
    await expect(worker.handleCron()).resolves.toBeUndefined(); // воркер не роняет процесс
  });
});
