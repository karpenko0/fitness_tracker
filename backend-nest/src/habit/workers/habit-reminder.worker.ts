import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HabitNotificationService } from '../telegram/habit-notification.service';

/**
 * Каждую минуту:
 * 1) планирует SCHEDULED-уведомления для активных привычек с невыполненным заданием на сегодня;
 * 2) отправляет напоминания, у которых наступило локальное время (SLA: не позднее ~2 минут
 *    после планового времени при штатной работе — выборка ежеминутная).
 * Ошибки не роняют воркер и не меняют статусы привычек/заданий.
 */
@Injectable()
export class HabitReminderWorker {
  private readonly logger = new Logger(HabitReminderWorker.name);

  constructor(private readonly notifications: HabitNotificationService) {}

  @Cron('* * * * *', { name: 'habit-reminder' })
  async handleCron(): Promise<void> {
    try {
      await this.notifications.ensureScheduledNotifications();
      const result = await this.notifications.sendDueNotifications();
      if (result.sent > 0 || result.blocked > 0 || result.failed > 0) {
        this.logger.log(`Reminders: sent=${result.sent} retried=${result.retried} failed=${result.failed} blocked=${result.blocked}`);
      }
    } catch (error) {
      this.logger.error('Habit reminder pass failed', error as Error);
    }
  }
}
