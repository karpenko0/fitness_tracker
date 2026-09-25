import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const HABIT_TYPES = ['WATER', 'STEPS', 'SLEEP', 'PROTEIN', 'MEDICATION', 'STRETCHING', 'CUSTOM'] as const;
export const HABIT_GOAL_TYPES = ['COUNT', 'BOOLEAN'] as const;
export const HABIT_UNITS = ['STEPS', 'ML', 'GRAMS', 'MINUTES', 'TIMES'] as const;
export const HABIT_SCHEDULES = ['DAILY', 'WEEKDAYS', 'ONE_TIME'] as const;

export class CreateHabitDto {
  @ApiProperty({ description: 'Название привычки', example: 'Пить воду' })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ enum: HABIT_TYPES })
  @IsIn(HABIT_TYPES)
  type!: (typeof HABIT_TYPES)[number];

  @ApiProperty({ enum: HABIT_GOAL_TYPES, description: 'Тип цели. Для MEDICATION допускается только BOOLEAN.' })
  @IsIn(HABIT_GOAL_TYPES)
  goalType!: (typeof HABIT_GOAL_TYPES)[number];

  @ApiPropertyOptional({ description: 'Значение цели (> 0). Для BOOLEAN не передаётся.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  goalValue?: number;

  @ApiPropertyOptional({ enum: HABIT_UNITS })
  @IsOptional()
  @IsIn(HABIT_UNITS)
  unit?: (typeof HABIT_UNITS)[number];

  @ApiProperty({ enum: HABIT_SCHEDULES })
  @IsIn(HABIT_SCHEDULES)
  schedule!: (typeof HABIT_SCHEDULES)[number];

  @ApiPropertyOptional({ type: [Number], description: 'Дни недели 1..7 (ПН..ВС). Обязательны для WEEKDAYS.' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays?: number[];

  @ApiPropertyOptional({ description: 'Дата разового задания (YYYY-MM-DD). Обязательна для ONE_TIME.' })
  @IsOptional()
  @IsDateString()
  oneTimeDate?: string;

  @ApiProperty({ description: 'IANA timezone пользователя', example: 'Europe/Moscow' })
  @IsString()
  timezone!: string;

  @ApiPropertyOptional({ description: 'Локальное время напоминания HH:mm', example: '09:30' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'reminderTime must be in HH:mm format' })
  reminderTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  telegramChatId?: string;
}

export class UpdateHabitDto extends PartialType(CreateHabitDto) {
  @ApiProperty({ description: 'Текущая версия привычки (optimistic locking)' })
  @IsInt()
  @Min(1)
  version!: number;
}
