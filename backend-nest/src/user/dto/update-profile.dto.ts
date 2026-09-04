import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, Matches, ArrayUnique, ValidateIf, ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments, Validate } from 'class-validator';
import { Type } from 'class-transformer';

@ValidatorConstraint({ name: 'isIanaTimezone', async: false })
class IsIanaTimezoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;

    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid IANA timezone`;
  }
}

export enum GenderEnum {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  NOT_SPECIFIED = 'NOT_SPECIFIED',
}

export enum FitnessGoalEnum {
  WEIGHT_LOSS = 'WEIGHT_LOSS',
  MUSCLE_GAIN = 'MUSCLE_GAIN',
  MAINTENANCE = 'MAINTENANCE',
  HEALTH = 'HEALTH',
  FLEXIBILITY = 'FLEXIBILITY',
  ENDURANCE = 'ENDURANCE',
}

export enum ExperienceLevelEnum {
  BEGINNER = 'BEGINNER',
  INTERMEDIATE = 'INTERMEDIATE',
  ADVANCED = 'ADVANCED',
}

export enum TrainingLocationEnum {
  GYM = 'GYM',
  HOME = 'HOME',
  OUTDOOR = 'OUTDOOR',
  MIXED = 'MIXED',
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ enum: GenderEnum })
  @IsOptional()
  @IsEnum(GenderEnum)
  gender?: GenderEnum | null;

  @ApiPropertyOptional({ description: 'Birth date in YYYY-MM-DD format' })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'birthDate must be in YYYY-MM-DD format' })
  @IsDateString({}, { message: 'birthDate must be a valid ISO date' })
  birthDate?: string | null;

  @ApiPropertyOptional({ description: 'Height in cm', minimum: 100, maximum: 250 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(250)
  heightCm?: number | null;

  @ApiPropertyOptional({ description: 'Weight in kg', minimum: 25, maximum: 400 })
  @IsOptional()
  @Type(() => Number)
  @Min(25)
  @Max(400)
  weightKg?: number | null;

  @ApiPropertyOptional({ enum: FitnessGoalEnum })
  @IsOptional()
  @IsEnum(FitnessGoalEnum)
  fitnessGoal?: FitnessGoalEnum | null;

  @ApiPropertyOptional({ enum: ExperienceLevelEnum })
  @IsOptional()
  @IsEnum(ExperienceLevelEnum)
  experienceLevel?: ExperienceLevelEnum | null;

  @ApiPropertyOptional({ enum: TrainingLocationEnum })
  @IsOptional()
  @IsEnum(TrainingLocationEnum)
  trainingLocation?: TrainingLocationEnum | null;

  @ApiPropertyOptional({ description: 'Training frequency in days per week', minimum: 1, maximum: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  trainingFrequency?: number | null;

  @ApiPropertyOptional({ description: 'Preferred workout duration in minutes', enum: [15, 30, 45, 60, 90] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsEnum([15, 30, 45, 60, 90] as const)
  preferredWorkoutDuration?: 15 | 30 | 45 | 60 | 90 | null;

  @ApiPropertyOptional({ type: [String], description: 'Equipment values' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  equipment?: string[];

  @ApiPropertyOptional({ description: 'Limitations description', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  limitations?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'Training preferences' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  trainingPreferences?: string[];

  @ApiPropertyOptional({ description: 'Needs nutrition plan' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  nutritionPlanNeeded?: boolean;

  @ApiPropertyOptional({ type: [Number], description: 'Notification days, Monday=1' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  notificationDays?: number[];

  @ApiPropertyOptional({ description: 'Notification time in HH:mm format' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'notificationTime must be in HH:mm format' })
  notificationTime?: string | null;

  @ApiPropertyOptional({ enum: ['ru', 'en'] })
  @IsOptional()
  @IsEnum(['ru', 'en'] as const)
  locale?: 'ru' | 'en';

  @ApiPropertyOptional({ description: 'IANA timezone' })
  @IsOptional()
  @IsString()
  @Validate(IsIanaTimezoneConstraint)
  timezone?: string;
}
