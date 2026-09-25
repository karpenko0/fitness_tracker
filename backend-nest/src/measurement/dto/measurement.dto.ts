import { IsOptional, IsDateString, IsNumber, Max, Min, IsString, IsInt, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/swagger';

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
  timezone!: string;

  @IsOptional()
  @IsString()
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

export class UpdateMeasurementDto extends PartialType(CreateMeasurementDto) {
  @IsInt()
  @Min(1)
  version!: number;
}

export class MeasurementValueDto {
  @IsString()
  metric!: string;

  @IsNumber()
  value!: number;
}
