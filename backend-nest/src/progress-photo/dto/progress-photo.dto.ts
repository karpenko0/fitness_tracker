import { IsOptional, IsDateString, IsString, IsInt, Min, IsIn, IsUrl } from 'class-validator';

export class CreateProgressPhotoDto {
  @IsOptional()
  @IsString()
  measurementId?: string;

  @IsDateString()
  localDate: string;

  @IsString()
  @IsIn(['FRONT', 'SIDE_LEFT', 'SIDE_RIGHT', 'BACK', 'OTHER'])
  pose: string;

  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  mimeType: string;

  @IsInt()
  @Min(0)
  @Max(10 * 1024 * 1024) // 10 MB
  sizeBytes: number;

  @IsOptional()
  @IsString()
  storageKey: string;

  @IsOptional()
  @IsString()
  previewStorageKey?: string;

  @IsOptional()
  @IsString()
  status?: string; // PENDING, READY, DELETED, FAILED
}

export class UpdateProgressPhotoDto extends CreateProgressPhotoDto {
  // All fields are optional for update
  @IsOptional()
  @IsString()
  measurementId?: string;

  @IsOptional()
  @IsDateString()
  localDate?: string;

  @IsOptional()
  @IsString()
  @IsIn(['FRONT', 'SIDE_LEFT', 'SIDE_RIGHT', 'BACK', 'OTHER'])
  pose?: string;

  @IsOptional()
  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10 * 1024 * 1024) // 10 MB
  sizeBytes?: number;

  @IsOptional()
  @IsString()
  storageKey?: string;

  @IsOptional()
  @IsString()
  previewStorageKey?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsInt()
  @Min(1)
  version: number;
}