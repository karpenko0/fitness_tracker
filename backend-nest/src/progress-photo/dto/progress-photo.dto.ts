import { IsOptional, IsDateString, IsString, IsInt, Min, Max, IsIn, IsUUID, MaxLength } from 'class-validator';
import { ProgressPhotoPose, ProgressPhotoStatus } from '@prisma/client';

const POSES = ['FRONT', 'SIDE_LEFT', 'SIDE_RIGHT', 'BACK', 'OTHER'] as const;
const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const STATUSES = ['PENDING', 'READY', 'DELETED', 'FAILED'] as const;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export class CreateProgressPhotoDto {
  @IsOptional()
  @IsUUID()
  measurementId?: string;

  @IsDateString()
  localDate!: string;

  @IsIn(POSES)
  pose!: ProgressPhotoPose;

  @IsIn(MIME_TYPES)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_BYTES)
  sizeBytes!: number;

  /** Приватный ключ в объектном хранилище (обязателен: колонка NOT NULL). */
  @IsString()
  @MaxLength(512)
  storageKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  previewStorageKey?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: ProgressPhotoStatus;
}

export class UpdateProgressPhotoDto {
  @IsOptional()
  @IsUUID()
  measurementId?: string;

  @IsOptional()
  @IsDateString()
  localDate?: string;

  @IsOptional()
  @IsIn(POSES)
  pose?: ProgressPhotoPose;

  @IsOptional()
  @IsIn(MIME_TYPES)
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_BYTES)
  sizeBytes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  storageKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  previewStorageKey?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: ProgressPhotoStatus;
}
