import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class TaskSkipDto {
  @ApiProperty({ description: 'Текущая версия задания (optimistic locking)' })
  @IsInt()
  @Min(1)
  version!: number;
}
