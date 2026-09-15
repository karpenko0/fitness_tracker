import { Body, Controller, ForbiddenException, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { UserRequest } from '../common/interfaces/user-request.interface';
import { ProgressionConfigService } from './progression-config.service';

class UpdateProgressionConfigDto {
  @IsOptional() @IsNumber() @Min(0) @Max(10) increasePercent?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(50) decreasePercent?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(10) maxIncreasePercent?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('super-admin-progression')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/super-admin/progression/config')
export class ProgressionConfigController {
  constructor(private readonly config: ProgressionConfigService) {}
  @Get() async get(@GetCurrentUser() actor: UserRequest) { this.require(actor); return this.config.get(); }
  @Put() async update(@GetCurrentUser() actor: UserRequest, @Body() body: UpdateProgressionConfigDto) { this.require(actor); return this.config.update(actor.userId, body); }
  private require(actor: UserRequest) { if (!actor.roles.includes('SUPER_ADMIN')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'SUPER_ADMIN role is required' }); }
}
