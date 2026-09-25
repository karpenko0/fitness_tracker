import { IsOptional, IsDateString, IsString, IsInt, Min, Max, IsIn } from 'class-validator';
import { PartialType } from '@nestjs/swagger';

export class CreateProgressPhotoDto {
  @IsOptional()
  @IsString()
  measurementId?: string;

  @IsDateString()
  localDate!: string;

  @IsString()
  @IsIn(['FRONT', 'SIDE_LEFT', 'SIDE_RIGHT', 'BACK', 'OTHER'])
  pose!: string;

  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  mimeType!: string;

  @IsInt()
  @Min(0)
  @Max(10 * 1024 * 1024) // 10 MB
  sizeBytes!: number;

  @IsString()
  storageKey!: string;

  @IsOptional()
  @IsString()
  previewStorageKey?: string;

  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'READY', 'DELETED', 'FAILED'])
  status?: string; // PENDING, READY, DELETED, FAILED
}

export class UpdateProgressPhotoDto extends PartialType(CreateProgressPhotoDto) {
  @IsInt()
  @Min(1)
  version!: number;
}
