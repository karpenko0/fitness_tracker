import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional,
  IsNumber, IsString, Matches, Max, MaxLength, Min, Validate, ValidateIf,
  ValidatorConstraint, ValidatorConstraintInterface, ValidateNested,
} from 'class-validator';

export enum OnboardingStepDto { GOAL = 'GOAL', TRAINING_CONTEXT = 'TRAINING_CONTEXT', EXPERIENCE = 'EXPERIENCE', BODY_DATA = 'BODY_DATA', EQUIPMENT = 'EQUIPMENT', LIMITATIONS = 'LIMITATIONS', REMINDERS = 'REMINDERS', NUTRITION = 'NUTRITION', REVIEW = 'REVIEW' }
export enum FitnessGoalDto { WEIGHT_LOSS = 'WEIGHT_LOSS', MUSCLE_GAIN = 'MUSCLE_GAIN', MAINTENANCE = 'MAINTENANCE', STRENGTH = 'STRENGTH', ENDURANCE = 'ENDURANCE', HEALTH = 'HEALTH', MOBILITY_RECOVERY = 'MOBILITY_RECOVERY' }
export enum TrainingLocationDto { GYM = 'GYM', HOME = 'HOME', OUTDOOR = 'OUTDOOR', MIXED = 'MIXED' }
export enum ExperienceLevelDto { BEGINNER = 'BEGINNER', INTERMEDIATE = 'INTERMEDIATE', ADVANCED = 'ADVANCED' }
export enum GenderDto { MALE = 'MALE', FEMALE = 'FEMALE', NOT_SPECIFIED = 'NOT_SPECIFIED' }

@ValidatorConstraint({ name: 'adultAge', async: false })
class AdultAgeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date >= new Date()) return false;
    const now = new Date();
    let age = now.getUTCFullYear() - date.getUTCFullYear();
    if (now.getUTCMonth() < date.getUTCMonth() || (now.getUTCMonth() === date.getUTCMonth() && now.getUTCDate() < date.getUTCDate())) age--;
    return age >= 14 && age <= 100;
  }
  defaultMessage() { return 'birthDate must represent an age between 14 and 100 years'; }
}

@ValidatorConstraint({ name: 'ianaTimezone', async: false })
class IanaTimezoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try { Intl.DateTimeFormat(undefined, { timeZone: value }); return true; } catch { return false; }
  }
}

export class OnboardingDataDto {
  @ApiPropertyOptional({ enum: FitnessGoalDto }) @IsOptional() @IsEnum(FitnessGoalDto) fitnessGoal?: FitnessGoalDto | null;
  @ApiPropertyOptional({ enum: TrainingLocationDto }) @IsOptional() @IsEnum(TrainingLocationDto) trainingLocation?: TrainingLocationDto | null;
  @ApiPropertyOptional({ minimum: 2, maximum: 7 }) @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(7) trainingFrequency?: number | null;
  @ApiPropertyOptional({ enum: [15, 30, 45, 60, 90] }) @IsOptional() @Type(() => Number) @IsInt() @IsEnum([15, 30, 45, 60, 90]) preferredWorkoutDuration?: number | null;
  @ApiPropertyOptional({ enum: ExperienceLevelDto }) @IsOptional() @IsEnum(ExperienceLevelDto) experienceLevel?: ExperienceLevelDto | null;
  @ApiPropertyOptional({ enum: GenderDto }) @IsOptional() @IsEnum(GenderDto) gender?: GenderDto | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_o, v) => v !== null) @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString() @Validate(AdultAgeConstraint) birthDate?: string | null;
  @ApiPropertyOptional({ minimum: 100, maximum: 250 }) @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(250) heightCm?: number | null;
  @ApiPropertyOptional({ minimum: 25, maximum: 400 }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }) @Min(25) @Max(400) weightKg?: number | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) equipment?: string[] | null;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) limitations?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsString({ each: true }) trainingPreferences?: string[] | null;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayUnique() @Type(() => Number) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) notificationDays?: number[] | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) notificationTime?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Validate(IanaTimezoneConstraint) timezone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() nutritionPlanNeeded?: boolean | null;
}

export class UpdateOnboardingDraftDto {
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) version!: number;
  @ApiProperty({ enum: OnboardingStepDto }) @IsEnum(OnboardingStepDto) currentStep!: OnboardingStepDto;
  @ApiProperty({ type: OnboardingDataDto }) @Type(() => OnboardingDataDto) @ValidateNested() data!: OnboardingDataDto;
}

export class CompleteOnboardingDto {
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) draftVersion!: number;
}

export class OptionsQueryDto {
  @ApiPropertyOptional({ enum: ['ru', 'en'], default: 'ru' }) @IsOptional() @IsEnum(['ru', 'en']) locale?: 'ru' | 'en';
}
