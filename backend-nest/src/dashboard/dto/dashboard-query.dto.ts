import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DashboardQueryDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === undefined ? false : value === true || value === 'true' ? true : value === false || value === 'false' ? false : value)
  @IsBoolean()
  forceRefresh = false;
}
