import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AdminDashboardQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
