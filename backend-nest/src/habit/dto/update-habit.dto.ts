import { IsString, IsEnum, IsOptional, IsNumber, IsBoolean, IsDate, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { HabitType } from './habit.entity';
import { GoalType } from './habit.entity';
import { Frequency } from './habit.entity';

export class UpdateHabitDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(Object.values(HabitType))
  type?: HabitType;

  @IsOptional()
  @IsEnum(Object.values(GoalType))
  goalType?: GoalType;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  goalValue?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsEnum(Object.values(Frequency))
  frequency?: Frequency;

  @IsOptional()
  @IsArray()
  @IsNumber()
  @Type(() => Number)
  daysOfWeek?: number[];

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  date?: Date;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;

  @IsNumber()
  @IsNotEmpty()
  version: number;
}