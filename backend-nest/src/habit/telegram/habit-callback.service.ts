import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { HabitTaskService } from '../habit-task.service';

export interface TelegramCallbackUpdate {
  callback_query?: {
    id?: string;
    from?: { id?: number };
    data?: string;
  };
}

/**
 * Callback «Отметить выполненной» из Telegram (SPEC-009):
 * - callback другого Telegram-пользователя отклоняется;
 * - повторный callback (тот же callback_query.id) не создаёт дублирующее выполнение
 *   (идемпотентность по ключу `tg:<callback_query.id>`);
 * - завершение задания идёт через тот же code path, что и обычное обновление прогресса
 *   (SET до цели для COUNT, SET без значения для BOOLEAN), source = TELEGRAM_CALLBACK.
 */
@Injectable()
export class HabitCallbackService {
  private readonly logger = new Logger(HabitCallbackService.name);

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    private readonly tasks: HabitTaskService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async handleCallback(update: TelegramCallbackUpdate): Promise<{ ok: boolean; alreadyDone?: boolean; completed?: boolean; taskId?: string }> {
    const callback = update?.callback_query;
    if (!callback?.id || !callback.data) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'callback_query.id and callback_query.data are required' });
    }
    if (!callback.data.startsWith('habit_done:')) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `Unsupported callback data: ${callback.data}` });
    }
    const taskId = callback.data.slice('habit_done:'.length);
    if (!taskId) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Task id is required in callback data' });
    }

    const task = await this.prisma.habitTask.findFirst({ where: { id: taskId }, include: { habit: true } });
    if (!task) {
      throw new NotFoundException({ code: 'HABIT_TASK_NOT_FOUND', message: 'Habit task was not found' });
    }

    // Callback другого Telegram-пользователя отклоняется
    const telegramUserId = callback.from?.id == null ? null : String(callback.from.id);
    if (!task.habit.telegramChatId || telegramUserId !== task.habit.telegramChatId) {
      throw new ForbiddenException({ code: 'TELEGRAM_CALLBACK_FORBIDDEN', message: 'Callback does not belong to this habit owner' });
    }

    // Уже выполнено — идемпотентный ответ без ошибки
    if (task.status === 'COMPLETED') {
      return { ok: true, alreadyDone: true, taskId: task.id };
    }
    if (task.status !== 'PENDING') {
      return { ok: false, alreadyDone: false, taskId: task.id };
    }

    const dto =
      task.habit.goalType === 'BOOLEAN'
        ? { action: 'SET' as const, version: task.version }
        : { action: 'SET' as const, value: task.habit.goalValue == null ? undefined : Number(task.habit.goalValue), version: task.version };

    try {
      const result = await this.tasks.updateProgress(
        task.habit.userId,
        task.habit.id,
        task.id,
        dto,
        `tg:${callback.id}`,
        'TELEGRAM_CALLBACK',
      );
      return { ok: true, completed: result.status === 'COMPLETED', taskId: task.id };
    } catch (error) {
      // Гонка: задание закрылось между проверкой и обновлением — считаем идемпотентным успехом
      if (error instanceof ConflictException && (error.getResponse() as any)?.code === 'TASK_ALREADY_CLOSED') {
        return { ok: true, alreadyDone: true, taskId: task.id };
      }
      throw error;
    }
  }
}
