import { IsString, IsEnum, IsOptional, IsNumber, IsBoolean, ValidateIf, IsDate, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { HabitType } from './habit.entity';
import { GoalType } from './habit.entity';
import { Frequency } from './habit.entity';

export class CreateHabitDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(Object.values(HabitType))
  type: HabitType;

  @IsEnum(Object.values(GoalType))
  goalType: GoalType;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  goalValue?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsEnum(Object.values(Frequency))
  frequency: Frequency;

  @IsOptional()
  @IsArray()
  @IsNumber()
  @Type(() => Number)
  daysOfWeek?: number[]; // 1-7 (Monday-Sunday)

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  date?: Date;

  @IsString()
  @IsNotEmpty()
  timezone: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;
}