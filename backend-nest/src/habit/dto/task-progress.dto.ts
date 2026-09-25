import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class TaskProgressDto {
  @ApiProperty({ enum: ['ADD', 'SET'], description: 'ADD увеличивает прогресс, SET заменяет' })
  @IsIn(['ADD', 'SET'])
  action!: 'ADD' | 'SET';

  @ApiPropertyOptional({ description: 'Значение >= 0. Для BOOLEAN-привычек не передаётся.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value?: number;

  @ApiProperty({ description: 'Текущая версия задания (optimistic locking)' })
  @IsInt()
  @Min(1)
  version!: number;
}
