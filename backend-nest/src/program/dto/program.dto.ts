import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ExperienceLevel, FitnessGoal, TrainingLocation } from '@prisma/client';

export class CreateProgramDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(120) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiProperty({ enum: FitnessGoal }) @IsEnum(FitnessGoal) goal!: FitnessGoal;
  @ApiProperty({ enum: ExperienceLevel }) @IsEnum(ExperienceLevel) level!: ExperienceLevel;
  @ApiProperty({ enum: TrainingLocation }) @IsEnum(TrainingLocation) location!: TrainingLocation;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(52) durationWeeks!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(7) workoutsPerWeek!: number;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(10) @Max(180) estimatedWorkoutDurationMinutes!: number;
}

export class UpdateProgramDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional({ enum: FitnessGoal }) @IsOptional() @IsEnum(FitnessGoal) goal?: FitnessGoal;
  @ApiPropertyOptional({ enum: ExperienceLevel }) @IsOptional() @IsEnum(ExperienceLevel) level?: ExperienceLevel;
  @ApiPropertyOptional({ enum: TrainingLocation }) @IsOptional() @IsEnum(TrainingLocation) location?: TrainingLocation;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(52) durationWeeks?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(7) workoutsPerWeek?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(180) estimatedWorkoutDurationMinutes?: number;
}

export class CreateProgramDayDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) focus?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(7) scheduledWeekday?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(180) estimatedDurationMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRestDay?: boolean;
}

export class AddProgramExerciseDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
  @ApiProperty() @IsUUID() exerciseId!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) plannedSets?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) plannedRepsMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) plannedRepsMax?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() plannedWeightKg?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() targetRpe?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3600) restSeconds?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allowReplacement?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isOptional?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirmDuplicate?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ReorderItemDto {
  @ApiProperty() @IsUUID() id!: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) orderIndex!: number;
}

export class ReorderDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
  @ApiProperty({ type: [ReorderItemDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReorderItemDto) items!: ReorderItemDto[];
}

export class VersionedDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class ProgramQueryDto {
  @ApiPropertyOptional({ enum: FitnessGoal }) @IsOptional() @IsEnum(FitnessGoal) goal?: FitnessGoal;
  @ApiPropertyOptional({ enum: ExperienceLevel }) @IsOptional() @IsEnum(ExperienceLevel) level?: ExperienceLevel;
  @ApiPropertyOptional({ enum: TrainingLocation }) @IsOptional() @IsEnum(TrainingLocation) location?: TrainingLocation;
  @ApiPropertyOptional() @IsOptional() @IsString() equipment?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === undefined ? undefined : value === true || value === 'true') @IsBoolean() isProOnly?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class ExerciseQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() primaryMuscle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() equipment?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() difficulty?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() excludeContraindications?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class CreateCustomExerciseDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @IsString({ each: true }) primaryMuscles!: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) secondaryMuscles?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) equipment?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() difficulty?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() exerciseType?: string;
}
