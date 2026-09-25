import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { IdempotencyService } from '../common/services/idempotency.service';
import { TaskProgressDto } from './dto/task-progress.dto';
import { HabitLocalDateService } from './habit-local-date.service';

type Tx = Prisma.TransactionClient;

/**
 * Ежедневные задания привычек (SPEC-009):
 * - активная ежедневная привычка -> одно задание на локальную дату;
 * - WEEKDAYS -> только в выбранные дни; ONE_TIME -> одно задание на указанную дату;
 * - PAUSED/ARCHIVED не создают новых заданий;
 * - два задания на одну привычку и одну локальную дату невозможны (@@unique + upsert);
 * - ADD увеличивает прогресс, SET заменяет; отрицательные значения -> 400;
 * - при достижении/превышении цели задание становится COMPLETED;
 * - для BOOLEAN нельзя передать числовое значение;
 * - незавершённое задание можно пропустить (SKIPPED);
 * - по окончании локального дня незавершённое задание становится EXPIRED (COMPLETED — никогда).
 */
@Injectable()
export class HabitTaskService {
  private readonly logger = new Logger(HabitTaskService.name);

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    private readonly localDates: HabitLocalDateService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Создаёт задание для привычки, если по её расписанию оно положено на целевую дату.
   * Идемпотентно: upsert по (habitId, localDate) + страховка от гонки через P2002.
   */
  async ensureTaskForHabit(habit: any, now: Date = new Date(), client: Tx | PrismaClient = this.prisma) {
    if (habit.status !== 'ACTIVE') return null;

    let target: Date | null = null;
    if (habit.schedule === 'ONE_TIME') {
      target = habit.oneTimeDate ? this.localDates.localDateIn(habit.timezone, new Date(habit.oneTimeDate)) : null;
    } else {
      const today = this.localDates.localDateIn(habit.timezone, now);
      if (habit.schedule === 'DAILY') {
        target = today;
      } else if (habit.schedule === 'WEEKDAYS') {
        const weekday = this.localDates.weekdayIn(habit.timezone, now);
        target = (habit.weekdays ?? []).includes(weekday) ? today : null;
      }
    }
    if (!target) return null;

    try {
      return await client.habitTask.upsert({
        where: { habitId_localDate: { habitId: habit.id, localDate: target } },
        create: { habitId: habit.id, localDate: target, status: 'PENDING' },
        update: {},
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return client.habitTask.findUnique({ where: { habitId_localDate: { habitId: habit.id, localDate: target } } });
      }
      throw error;
    }
  }

  /** Воркер генерации: задания на сегодня для всех активных привычек. */
  async generateForAllActiveHabits(now: Date = new Date()): Promise<number> {
    const habits = await this.prisma.habit.findMany({ where: { status: 'ACTIVE' } });
    let count = 0;
    for (const habit of habits) {
      const task = await this.ensureTaskForHabit(habit, now);
      if (task) count += 1;
    }
    return count;
  }

  /**
   * GET /habits/today — задания на локальную дату каждой привычки пользователя.
   * Для активных привычек недостающее задание на сегодня создаётся на месте (идемпотентно).
   */
  async getToday(userId: string, now: Date = new Date()) {
    const habits = await this.prisma.habit.findMany({
      where: { userId, status: { in: ['ACTIVE', 'PAUSED'] } },
      orderBy: { createdAt: 'asc' },
    });

    for (const habit of habits) {
      if (habit.status === 'ACTIVE') await this.ensureTaskForHabit(habit, now);
    }

    const todayByHabit = new Map<string, Date>();
    for (const habit of habits) {
      todayByHabit.set(habit.id, this.localDates.localDateIn(habit.timezone, now));
    }
    const uniqueDates = [...new Set([...todayByHabit.values()].map((d) => d.getTime()))].map((t) => new Date(t));

    const tasks =
      habits.length === 0
        ? []
        : await this.prisma.habitTask.findMany({
            where: { habitId: { in: habits.map((habit) => habit.id) }, localDate: { in: uniqueDates } },
          });

    const items = habits.map((habit) => {
      const today = todayByHabit.get(habit.id)!;
      const task = tasks.find((t) => t.habitId === habit.id && t.localDate.getTime() === today.getTime()) ?? null;
      return {
        habit: {
          id: habit.id,
          title: habit.title,
          type: habit.type,
          goalType: habit.goalType,
          goalValue: habit.goalValue == null ? null : Number(habit.goalValue),
          unit: habit.unit,
          schedule: habit.schedule,
          timezone: habit.timezone,
          reminderTime: habit.reminderTime,
          status: habit.status,
          currentStreak: habit.currentStreak,
          bestStreak: habit.bestStreak,
        },
        localDate: this.localDates.localDateString(habit.timezone, now),
        task: task ? this.serializeTask(task) : null,
      };
    });

    return { items };
  }

  /** ADD / SET прогресса задания. */
  async updateProgress(userId: string, habitId: string, taskId: string, dto: TaskProgressDto, key?: string) {
    return this.idempotency.run(userId, key, { habitId, taskId, ...dto }, async (tx) => {
      const task = await this.loadEditableTask(tx, userId, habitId, taskId, dto.version);
      const habit = task.habit;

      let nextProgress: number | null;
      let completed: boolean;

      if (habit.goalType === 'BOOLEAN') {
        if (dto.value !== undefined && dto.value !== null) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'BOOLEAN habit task does not accept a numeric value',
            details: [{ field: 'value', message: 'must be empty for BOOLEAN habits' }],
          });
        }
        nextProgress = null;
        completed = true; // любое действие SET/ADD без значения отмечает выполнение
      } else {
        if (dto.value === undefined || dto.value === null) {
          throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'value is required for COUNT habits', details: [{ field: 'value', message: 'required' }] });
        }
        if (dto.value < 0) {
          throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'value must not be negative', details: [{ field: 'value', message: 'must be >= 0' }] });
        }
        const current = task.progressValue == null ? 0 : Number(task.progressValue);
        nextProgress = dto.action === 'ADD' ? current + dto.value : dto.value;
        const goal = habit.goalValue == null ? null : Number(habit.goalValue);
        completed = goal != null && nextProgress >= goal;
      }

      await tx.habitTaskEvent.create({
        data: { taskId: task.id, action: dto.action, value: dto.value ?? null, source: 'API' },
      });

      const updated = await tx.habitTask.update({
        where: { id: task.id },
        data: {
          progressValue: nextProgress,
          status: completed ? 'COMPLETED' : task.status,
          completedAt: completed ? new Date() : task.completedAt,
          version: { increment: 1 },
        },
      });
      return this.serializeTask(updated);
    });
  }

  /** Пропуск незавершённого задания. */
  async skip(userId: string, habitId: string, taskId: string, version: number, key?: string) {
    return this.idempotency.run(userId, key, { habitId, taskId, action: 'SKIP', version }, async (tx) => {
      const task = await this.loadEditableTask(tx, userId, habitId, taskId, version);
      const updated = await tx.habitTask.update({
        where: { id: task.id },
        data: { status: 'SKIPPED', skippedAt: new Date(), version: { increment: 1 } },
      });
      return this.serializeTask(updated);
    });
  }

  /**
   * По окончании локального дня незавершённые задания становятся EXPIRED.
   * COMPLETED не затрагиваются (фильтр status = PENDING), SKIPPED уже закрыт.
   */
  async expireOverdueTasks(now: Date = new Date()): Promise<number> {
    const pending = await this.prisma.habitTask.findMany({
      where: { status: 'PENDING' },
      include: { habit: { select: { timezone: true } } },
    });
    const overdueIds = pending
      .filter((task) => task.localDate.getTime() < this.localDates.localDateIn(task.habit.timezone, now).getTime())
      .map((task) => task.id);
    if (overdueIds.length === 0) return 0;
    const result = await this.prisma.habitTask.updateMany({
      where: { id: { in: overdueIds }, status: 'PENDING' },
      data: { status: 'EXPIRED', expiredAt: now },
    });
    return result.count;
  }

  private async loadEditableTask(tx: Tx, userId: string, habitId: string, taskId: string, version: number) {
    const task = await tx.habitTask.findFirst({
      where: { id: taskId, habitId, habit: { userId } },
      include: { habit: true },
    });
    if (!task) {
      throw new NotFoundException({ code: 'HABIT_TASK_NOT_FOUND', message: 'Habit task was not found' });
    }
    if (task.version !== version) {
      throw new ConflictException({
        code: 'HABIT_TASK_VERSION_CONFLICT',
        message: 'Habit task was modified in another session',
        details: [{ task: this.serializeTask(task) }],
      });
    }
    if (task.status !== 'PENDING') {
      throw new ConflictException({
        code: 'TASK_ALREADY_CLOSED',
        message: `Task is already ${task.status}`,
      });
    }
    return task;
  }

  private serializeTask(task: any) {
    return {
      id: task.id,
      habitId: task.habitId,
      localDate: task.localDate instanceof Date ? task.localDate.toISOString().slice(0, 10) : String(task.localDate).slice(0, 10),
      status: task.status,
      progressValue: task.progressValue == null ? null : Number(task.progressValue),
      completedAt: task.completedAt ?? null,
      skippedAt: task.skippedAt ?? null,
      expiredAt: task.expiredAt ?? null,
      version: task.version,
    };
  }
}
