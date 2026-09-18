import { IsOptional, IsDateString, IsNumber, Max, Min, IsString, IsInt, ValidateIf } from 'class-validator';

export class CreateMeasurementDto {
  @IsDateString()
  measuredAt: string;

  @IsString()
  timezone: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(500)
  weightKg?: number;

  @IsOptional()
  circumferencesCm?: {
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
  };
}

export class UpdateMeasurementDto extends CreateMeasurementDto {
  // All fields are optional for update
  @IsOptional()
  @IsDateString()
  measuredAt?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(500)
  weightKg?: number;

  @IsOptional()
  circumferencesCm?: {
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
  };

  @IsInt()
  @Min(1)
  version: number;
}

export class MeasurementValueDto {
  @IsInt()
  @Min(0)
  value: number;
}