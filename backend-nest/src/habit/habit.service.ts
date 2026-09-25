import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { IdempotencyService } from '../common/services/idempotency.service';
import { CreateHabitDto, UpdateHabitDto } from './dto/create-habit.dto';
import { HabitValidationService } from './habit-validation.service';
import { HabitTaskService } from './habit-task.service';

export const MAX_ACTIVE_HABITS = 20;

@Injectable()
export class HabitService {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    private readonly validation: HabitValidationService,
    private readonly idempotency: IdempotencyService,
    private readonly tasks: HabitTaskService,
  ) {}

  async create(userId: string, dto: CreateHabitDto, key?: string) {
    this.validation.validate({ ...dto });
    return this.idempotency.run(userId, key, dto, async (tx) => {
      const activeCount = await tx.habit.count({ where: { userId, status: 'ACTIVE' } });
      if (activeCount >= MAX_ACTIVE_HABITS) {
        throw new UnprocessableEntityException({
          code: 'HABIT_LIMIT_EXCEEDED',
          message: `Cannot have more than ${MAX_ACTIVE_HABITS} active habits`,
        });
      }
      const normalized = this.validation.normalize(dto);
      const duplicate = await tx.habit.findFirst({
        where: { userId, status: 'ACTIVE', title: { equals: normalized.title, mode: 'insensitive' } },
      });
      if (duplicate) {
        throw new ConflictException({
          code: 'DUPLICATE_ACTIVE_HABIT',
          message: 'An active habit with the same title already exists',
        });
      }
      const habit = await tx.habit.create({
        data: {
          userId,
          title: normalized.title,
          type: dto.type,
          goalType: dto.goalType,
          goalValue: normalized.goalValue,
          unit: normalized.unit,
          schedule: dto.schedule,
          weekdays: normalized.weekdays,
          oneTimeDate: normalized.oneTimeDate,
          timezone: dto.timezone,
          reminderTime: normalized.reminderTime,
          telegramChatId: normalized.telegramChatId,
          status: 'ACTIVE',
        },
      });
      // Задание на сегодня (или на дату ONE_TIME) создаём сразу, идемпотентно
      await this.tasks.ensureTaskForHabit(habit, new Date(), tx);
      return this.serialize(habit);
    }, 201);
  }

  async list(userId: string, query: { status?: 'ACTIVE' | 'PAUSED' | 'ARCHIVED'; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const where: Prisma.HabitWhereInput = { userId, ...(query.status ? { status: query.status } : {}) };
    const [total, items] = await Promise.all([
      this.prisma.habit.count({ where }),
      this.prisma.habit.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { page, pageSize, total, items: items.map((habit) => this.serialize(habit)) };
  }

  async get(userId: string, habitId: string) {
    const habit = await this.prisma.habit.findFirst({ where: { id: habitId, userId } });
    if (!habit) throw new NotFoundException({ code: 'HABIT_NOT_FOUND', message: 'Habit was not found' });
    return this.serialize(habit);
  }

  async update(userId: string, habitId: string, dto: UpdateHabitDto, key?: string) {
    return this.idempotency.run(userId, key, { habitId, ...dto }, async (tx) => {
      const habit = await tx.habit.findFirst({ where: { id: habitId, userId } });
      if (!habit) throw new NotFoundException({ code: 'HABIT_NOT_FOUND', message: 'Habit was not found' });
      if (habit.version !== dto.version) {
        throw new ConflictException({ code: 'HABIT_VERSION_CONFLICT', message: 'Habit was modified in another session', details: [{ habit: this.serialize(habit) }] });
      }
      const merged = {
        title: dto.title ?? habit.title,
        type: dto.type ?? habit.type,
        goalType: dto.goalType ?? habit.goalType,
        goalValue: dto.goalValue !== undefined ? dto.goalValue : habit.goalValue == null ? null : Number(habit.goalValue),
        unit: dto.unit !== undefined ? dto.unit : habit.unit,
        schedule: dto.schedule ?? habit.schedule,
        weekdays: dto.weekdays ?? habit.weekdays,
        oneTimeDate: dto.oneTimeDate ?? (habit.oneTimeDate ? habit.oneTimeDate.toISOString().slice(0, 10) : null),
        timezone: dto.timezone ?? habit.timezone,
        reminderTime: dto.reminderTime !== undefined ? dto.reminderTime : habit.reminderTime,
      };
      this.validation.validate(merged);

      // Дубль среди активных (кроме самой этой привычки)
      if (habit.status === 'ACTIVE') {
        const title = merged.title.trim();
        const duplicate = await tx.habit.findFirst({
          where: { userId, status: 'ACTIVE', id: { not: habitId }, title: { equals: title, mode: 'insensitive' } },
        });
        if (duplicate) {
          throw new ConflictException({ code: 'DUPLICATE_ACTIVE_HABIT', message: 'An active habit with the same title already exists' });
        }
      }

      const normalized = this.validation.normalize(merged as CreateHabitDto);
      const updated = await tx.habit.update({
        where: { id: habitId },
        data: {
          title: normalized.title,
          type: merged.type as any,
          goalType: merged.goalType as any,
          goalValue: normalized.goalValue,
          unit: normalized.unit as any,
          schedule: merged.schedule as any,
          weekdays: normalized.weekdays,
          oneTimeDate: normalized.oneTimeDate,
          timezone: merged.timezone,
          reminderTime: normalized.reminderTime,
          version: { increment: 1 },
        },
      });
      return this.serialize(updated);
    });
  }

  async pause(userId: string, habitId: string, key?: string) {
    return this.transition(userId, habitId, key, 'pause', { from: ['ACTIVE'], to: 'PAUSED', stamp: 'pausedAt' });
  }

  async resume(userId: string, habitId: string, key?: string) {
    return this.transition(userId, habitId, key, 'resume', { from: ['PAUSED'], to: 'ACTIVE', stamp: null });
  }

  async archive(userId: string, habitId: string, key?: string) {
    return this.transition(userId, habitId, key, 'archive', { from: ['ACTIVE', 'PAUSED'], to: 'ARCHIVED', stamp: 'archivedAt' });
  }

  private async transition(
    userId: string,
    habitId: string,
    key: string | undefined,
    action: string,
    rules: { from: string[]; to: 'ACTIVE' | 'PAUSED' | 'ARCHIVED'; stamp: 'pausedAt' | 'archivedAt' | null },
  ) {
    return this.idempotency.run(userId, key, { habitId, action }, async (tx) => {
      const habit = await tx.habit.findFirst({ where: { id: habitId, userId } });
      if (!habit) throw new NotFoundException({ code: 'HABIT_NOT_FOUND', message: 'Habit was not found' });
      if (!rules.from.includes(habit.status)) {
        throw new ConflictException({
          code: 'HABIT_STATUS_INVALID',
          message: `Cannot ${action} a habit in status ${habit.status}`,
        });
      }
      const updated = await tx.habit.update({
        where: { id: habitId },
        data: {
          status: rules.to,
          ...(rules.stamp ? { [rules.stamp]: new Date() } : { pausedAt: null }),
          version: { increment: 1 },
        },
      });
      return this.serialize(updated);
    });
  }

  private serialize(habit: any) {
    return {
      id: habit.id,
      title: habit.title,
      type: habit.type,
      goalType: habit.goalType,
      goalValue: habit.goalValue == null ? null : Number(habit.goalValue),
      unit: habit.unit,
      schedule: habit.schedule,
      weekdays: habit.weekdays ?? [],
      oneTimeDate: habit.oneTimeDate ? new Date(habit.oneTimeDate).toISOString().slice(0, 10) : null,
      timezone: habit.timezone,
      reminderTime: habit.reminderTime,
      telegramChatId: habit.telegramChatId,
      status: habit.status,
      currentStreak: habit.currentStreak,
      bestStreak: habit.bestStreak,
      version: habit.version,
      createdAt: habit.createdAt,
      updatedAt: habit.updatedAt,
    };
  }
}
