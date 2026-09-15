import { IsISO8601, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ExerciseProgressionQueryDto {
  @IsOptional()
  @IsIn(['30d', '90d', '180d', '365d'])
  period = '90d';
}

export class ExerciseHistoryQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class WeeklyVolumeQueryDto {
  @IsOptional()
  @IsISO8601()
  date?: string;
}

export class RecalculateProgressionDto {
  @IsOptional()
  @IsIn(['PROGRESSION_V1'])
  algorithmVersion = 'PROGRESSION_V1';

  @IsOptional()
  @IsIn(['DATA_CORRECTION', 'ALGORITHM_UPDATE', 'ADMIN_REQUEST'])
  reason = 'ADMIN_REQUEST';
}
