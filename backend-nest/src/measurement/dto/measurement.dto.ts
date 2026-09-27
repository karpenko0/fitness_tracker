import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class CircumferencesCmDto {
  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(300)
  neck?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(300)
  chest?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(300)
  waist?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(300)
  abdomen?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(300)
  hips?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(300)
  bicepsLeft?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(300)
  bicepsRight?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(300)
  thighLeft?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(300)
  thighRight?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(300)
  calfLeft?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(300)
  calfRight?: number;
}

export class CreateMeasurementDto {
  @IsDateString()
  measuredAt!: string;

  @IsString()
  @MaxLength(64)
  timezone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(500)
  weightKg?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CircumferencesCmDto)
  circumferencesCm?: CircumferencesCmDto;
}

export class UpdateMeasurementDto {
  @IsOptional()
  @IsDateString()
  measuredAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(500)
  weightKg?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CircumferencesCmDto)
  circumferencesCm?: CircumferencesCmDto;

  @IsInt()
  @Min(1)
  version!: number;
}

export class MeasurementValueDto {
  @IsInt()
  value!: number;
}
