import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { HabitLocalDateService } from './habit-local-date.service';

export interface StreakTask {
  localDate: Date;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'EXPIRED';
}

export interface StreakHabitLike {
  schedule: string;
  weekdays: number[];
  oneTimeDate: Date | null;
  timezone: string;
  createdAt: Date;
}

/**
 * Расчёт streak (SPEC-009):
 * - последовательные выполненные запланированные задания увеличивают currentStreak;
 * - дни вне расписания не разрывают streak;
 * - SKIPPED и EXPIRED разрывают streak;
 * - невыполненное задание текущего дня не разрывает streak до конца локального дня;
 * - bestStreak не уменьшается при потере текущего streak;
 * - смена timezone не создаёт ложный разрыв (обход начинается с max(сегодня, дата последнего задания)).
 */
@Injectable()
export class HabitStreakService {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    private readonly localDates: HabitLocalDateService,
  ) {}

  /** Чистая функция: текущий streak по состояниям заданий. */
  computeCurrentStreak(habit: StreakHabitLike, tasks: StreakTask[], now: Date = new Date()): number {
    if (habit.schedule === 'ONE_TIME') {
      return tasks.some((task) => task.status === 'COMPLETED') ? 1 : 0;
    }

    const byDate = new Map<string, StreakTask['status']>();
    for (const task of tasks) {
      byDate.set(this.key(task.localDate), task.status);
    }

    const today = this.localDates.localDateIn(habit.timezone, now);
    const habitStart = this.localDates.localDateIn(habit.timezone, habit.createdAt);

    // Смена timezone на «западную» может сделать локальное «сегодня» раньше даты
    // последнего выполненного задания — начинаем обход с максимальной даты,
    // чтобы не получить ложный разрыв.
    let cursor = today;
    for (const task of tasks) {
      if (task.localDate.getTime() > cursor.getTime()) cursor = task.localDate;
    }

    let streak = 0;
    // Глубина обхода ограничена: не больше, чем длина истории заданий + запас
    const maxSteps = tasks.length + 400;
    for (let step = 0; step < maxSteps; step += 1) {
      if (cursor.getTime() < habitStart.getTime()) break;
      if (this.isScheduled(habit, cursor)) {
        const status = byDate.get(this.key(cursor));
        if (status === 'COMPLETED') {
          streak += 1;
        } else if (status === 'SKIPPED' || status === 'EXPIRED') {
          break; // разрыв
        } else {
          // PENDING или нет задания: текущий (или будущий после смены tz) день
          // ещё не закончился — не разрываем; прошедший запланированный день без
          // выполнения — разрыв.
          if (cursor.getTime() < today.getTime()) break;
        }
      }
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
    return streak;
  }

  /** Пересчитывает и сохраняет current/best streak привычки (в той же транзакции, что и мутация). */
  async recalcForHabit(habitId: string, client: Prisma.TransactionClient | PrismaClient = this.prisma, now: Date = new Date()): Promise<void> {
    const habit = await client.habit.findUnique({ where: { id: habitId } });
    if (!habit) return;
    const tasks = await client.habitTask.findMany({
      where: { habitId },
      select: { localDate: true, status: true },
    });
    const current = this.computeCurrentStreak(habit as unknown as StreakHabitLike, tasks as StreakTask[], now);
    const best = Math.max(habit.bestStreak, current);
    if (current !== habit.currentStreak || best !== habit.bestStreak) {
      await client.habit.update({ where: { id: habitId }, data: { currentStreak: current, bestStreak: best } });
    }
  }

  private isScheduled(habit: StreakHabitLike, date: Date): boolean {
    if (habit.schedule === 'DAILY') return true;
    if (habit.schedule === 'WEEKDAYS') return (habit.weekdays ?? []).includes(this.weekdayOfLocalDate(date));
    return false;
  }

  /**
   * День недели (1=ПН..7=ВС) значения, которое УЖЕ является локальной датой
   * (UTC-полночь). Конвертировать через timezone здесь нельзя: UTC-полночь
   * в «западных» зонах — это предыдущий календарный день.
   */
  private weekdayOfLocalDate(date: Date): number {
    return ((date.getUTCDay() + 6) % 7) + 1;
  }

  private key(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
