import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { HabitLocalDateService } from '../habit-local-date.service';
import { TelegramBotClient } from './telegram-bot.client';

/** Первая попытка + не более трёх retry (SPEC-009: «не более трёх попыток retry»). */
export const MAX_SEND_ATTEMPTS = 4;
export const MAX_RETRIES = 3;

/**
 * Telegram-напоминания о привычках (SPEC-009):
 * - напоминание отправляется в выбранное локальное время пользователя;
 * - не отправляется для завершённого задания и для паузированной/архивированной привычки;
 * - одно и то же напоминание не отправляется дважды (dedup по habitId+taskLocalDate+kind, статус SENT);
 * - при временной ошибке — не более трёх retry; при блокировке бота уведомления пользователя отключаются;
 * - ошибка доставки не меняет статус привычки или задания;
 * - текст для MEDICATION нейтральный: без названия препарата, дозировки и медицинских данных.
 */
@Injectable()
export class HabitNotificationService {
  private readonly logger = new Logger(HabitNotificationService.name);

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    private readonly localDates: HabitLocalDateService,
    private readonly telegram: TelegramBotClient,
  ) {}

  /**
   * Текст напоминания. Для привычек типа MEDICATION — строго нейтральный:
   * название привычки (которое может содержать препарат/дозировку) не подставляется.
   */
  buildReminderText(habit: { type: string; title: string }): string {
    if (habit.type === 'MEDICATION') {
      return '⏰ Пора отметить выполнение привычки';
    }
    return `⏰ Напоминание: ${habit.title}`;
  }

  /** Создаёт SCHEDULED-уведомления для активных привычек с невыполненным заданием на сегодня (идемпотентно). */
  async ensureScheduledNotifications(now: Date = new Date()): Promise<number> {
    const habits = await this.prisma.habit.findMany({
      where: {
        status: 'ACTIVE',
        reminderTime: { not: null },
        telegramChatId: { not: null },
        user: { notificationsDisabled: false },
      },
    });
    let created = 0;
    for (const habit of habits) {
      const today = this.localDates.localDateIn(habit.timezone, now);
      const task = await this.prisma.habitTask.findUnique({
        where: { habitId_localDate: { habitId: habit.id, localDate: today } },
      });
      if (!task || task.status !== 'PENDING') continue; // для завершённого задания уведомление не планируется
      const unique = { habitId_taskLocalDate_kind: { habitId: habit.id, taskLocalDate: today, kind: 'DAILY_REMINDER' } };
      const existing = await this.prisma.habitNotification.findUnique({ where: unique });
      if (existing) continue; // дубликат не создаётся
      await this.prisma.habitNotification.create({
        data: { habitId: habit.id, taskLocalDate: today, kind: 'DAILY_REMINDER', status: 'SCHEDULED' },
      });
      created += 1;
    }
    return created;
  }

  /** Локальное время 'HH:MM' в timezone привычки. */
  localTimeIn(timezone: string, when: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(when);
  }

  /** Напоминание пора отправлять: тот же локальный день и время >= reminderTime. */
  isDue(habit: { timezone: string; reminderTime: string | null }, taskLocalDate: Date, now: Date): boolean {
    if (!habit.reminderTime) return false;
    if (this.localDates.localDateString(habit.timezone, now) !== taskLocalDate.toISOString().slice(0, 10)) return false;
    return this.localTimeIn(habit.timezone, now) >= habit.reminderTime;
  }

  async sendDueNotifications(now: Date = new Date()): Promise<{ sent: number; retried: number; failed: number; blocked: number }> {
    const counters = { sent: 0, retried: 0, failed: 0, blocked: 0 };
    const candidates = await this.prisma.habitNotification.findMany({
      where: { status: { in: ['SCHEDULED', 'FAILED'] }, attempts: { lt: MAX_SEND_ATTEMPTS } },
      include: { habit: { include: { user: { select: { id: true, notificationsDisabled: true } } } } },
    });

    for (const notification of candidates) {
      const habit = notification.habit;
      if (!habit || !habit.telegramChatId || !habit.reminderTime) continue;

      // Архивированная привычка — напоминание отменяется окончательно;
      // паузированная — просто пропускаем (после resume в тот же день ещё может уйти).
      if (habit.status === 'ARCHIVED') {
        await this.prisma.habitNotification.update({ where: { id: notification.id }, data: { status: 'CANCELLED' } });
        continue;
      }
      if (habit.status !== 'ACTIVE') continue;
      if (habit.user?.notificationsDisabled) continue;

      const task = await this.prisma.habitTask.findUnique({
        where: { habitId_localDate: { habitId: habit.id, localDate: notification.taskLocalDate } },
      });
      if (!task || task.status !== 'PENDING') {
        // Задание выполнено/пропущено/истекло — напоминание не отправляется
        await this.prisma.habitNotification.update({ where: { id: notification.id }, data: { status: 'CANCELLED' } });
        continue;
      }
      if (!this.isDue(habit, notification.taskLocalDate, now)) continue;

      const result = await this.telegram.sendMessage(habit.telegramChatId, this.buildReminderText(habit));
      if (result.ok) {
        await this.prisma.habitNotification.update({
          where: { id: notification.id },
          data: { status: 'SENT', sentAt: now, attempts: { increment: 1 }, lastError: null },
        });
        counters.sent += 1;
        continue;
      }

      if (result.kind === 'blocked') {
        // Пользователь заблокировал бота: отключаем все его уведомления.
        // Статусы привычки и задания не меняются.
        await this.prisma.$transaction([
          this.prisma.user.update({ where: { id: habit.user.id }, data: { notificationsDisabled: true } }),
          this.prisma.habitNotification.update({
            where: { id: notification.id },
            data: { status: 'FAILED', lastError: 'BOT_BLOCKED', attempts: { increment: 1 } },
          }),
          this.prisma.habitNotification.updateMany({
            where: { habit: { userId: habit.user.id }, status: 'SCHEDULED', id: { not: notification.id } },
            data: { status: 'CANCELLED' },
          }),
        ]);
        counters.blocked += 1;
        continue;
      }

      // retry (временная ошибка) или fatal
      const attempts = notification.attempts + 1;
      const exhausted = result.kind === 'fatal' || attempts > MAX_RETRIES;
      await this.prisma.habitNotification.update({
        where: { id: notification.id },
        data: {
          status: exhausted ? 'FAILED' : 'SCHEDULED',
          attempts,
          lastError: result.message.slice(0, 500),
        },
      });
      if (exhausted) counters.failed += 1;
      else counters.retried += 1;
    }
    return counters;
  }
}
