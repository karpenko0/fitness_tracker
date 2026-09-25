import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateHabitDto } from './dto/create-habit.dto';

export interface HabitGoalSpec {
  title: string;
  type: string;
  goalType: string;
  goalValue?: number | null;
  unit?: string | null;
  schedule: string;
  weekdays?: number[] | null;
  oneTimeDate?: string | Date | null;
  timezone: string;
  reminderTime?: string | null;
}

/**
 * Доменные правила SPEC-009 «Создание и управление привычками»:
 * - привычка без названия, цели или timezone не создаётся;
 * - MEDICATION -> только BOOLEAN;
 * - STEPS -> только COUNT с единицей STEPS;
 * - WATER -> количество в миллилитрах (COUNT + ML);
 * - WEEKDAYS -> непустой список дней 1..7; ONE_TIME -> дата;
 * - reminderTime — валидное локальное время HH:mm; timezone — валидная IANA-зона.
 */
@Injectable()
export class HabitValidationService {
  validate(input: HabitGoalSpec): void {
    const fail = (message: string, field?: string) => {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message,
        details: field ? [{ field, message }] : undefined,
      });
    };

    // 1. Название, цель и timezone обязательны
    if (!input.title || input.title.trim().length === 0) fail('Habit title is required', 'title');
    if (!input.timezone || input.timezone.trim().length === 0) fail('Habit timezone is required', 'timezone');
    if (!input.goalType) fail('Habit goal type is required', 'goalType');

    // 2. Timezone — валидная IANA-зона
    if (!this.isValidTimezone(input.timezone)) fail(`Unknown timezone: ${input.timezone}`, 'timezone');

    // 3. Правила типа привычки и цели
    if (input.type === 'MEDICATION') {
      if (input.goalType !== 'BOOLEAN') fail('MEDICATION habit supports BOOLEAN goal only', 'goalType');
    }
    if (input.type === 'STEPS') {
      if (input.goalType !== 'COUNT') fail('STEPS habit supports COUNT goal only', 'goalType');
      if (input.unit !== 'STEPS') fail('STEPS habit requires STEPS unit', 'unit');
    }
    if (input.type === 'WATER') {
      if (input.goalType !== 'COUNT') fail('WATER habit supports COUNT goal only', 'goalType');
      if (input.unit !== 'ML') fail('WATER habit goal must be defined in milliliters (ML unit)', 'unit');
    }
    if (input.type === 'PROTEIN' && input.goalType === 'COUNT' && input.unit && input.unit !== 'GRAMS') {
      fail('PROTEIN habit goal must be defined in grams (GRAMS unit)', 'unit');
    }

    // 4. Значение цели
    if (input.goalType === 'BOOLEAN') {
      if (input.goalValue !== undefined && input.goalValue !== null) {
        fail('BOOLEAN goal must not have a numeric goalValue', 'goalValue');
      }
    } else {
      if (input.goalValue === undefined || input.goalValue === null) {
        fail('COUNT goal requires a numeric goalValue', 'goalValue');
      }
      if (typeof input.goalValue === 'number' && (!Number.isFinite(input.goalValue) || input.goalValue <= 0)) {
        fail('goalValue must be a positive number', 'goalValue');
      }
      if (input.goalType === 'COUNT' && !input.unit) fail('COUNT goal requires a unit', 'unit');
    }

    // 5. Расписание
    if (input.schedule === 'WEEKDAYS') {
      const days = input.weekdays ?? [];
      if (days.length === 0) fail('WEEKDAYS schedule requires at least one weekday', 'weekdays');
      const invalid = days.some((day) => !Number.isInteger(day) || day < 1 || day > 7);
      if (invalid) fail('weekdays must be integers between 1 (Monday) and 7 (Sunday)', 'weekdays');
    }
    if (input.schedule === 'ONE_TIME' && !input.oneTimeDate) {
      fail('ONE_TIME schedule requires oneTimeDate', 'oneTimeDate');
    }

    // 6. Время напоминания (если задано)
    if (input.reminderTime !== undefined && input.reminderTime !== null) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.reminderTime)) {
        fail('reminderTime must be in HH:mm format (00:00-23:59)', 'reminderTime');
      }
    }
  }

  isValidTimezone(timezone: string): boolean {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }

  /** Нормализует DTO к полям модели (trim заголовка, сортировка дней, отсечение лишнего). */
  normalize(dto: CreateHabitDto) {
    return {
      title: dto.title.trim(),
      goalValue: dto.goalType === 'BOOLEAN' ? null : dto.goalValue ?? null,
      unit: dto.goalType === 'BOOLEAN' ? null : dto.unit ?? null,
      weekdays: dto.schedule === 'WEEKDAYS' ? [...(dto.weekdays ?? [])].sort((a, b) => a - b) : [],
      oneTimeDate: dto.schedule === 'ONE_TIME' && dto.oneTimeDate ? new Date(dto.oneTimeDate) : null,
      reminderTime: dto.reminderTime ?? null,
      telegramChatId: dto.telegramChatId ?? null,
    };
  }
}
