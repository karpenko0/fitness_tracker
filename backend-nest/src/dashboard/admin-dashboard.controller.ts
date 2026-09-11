import { Controller, ForbiddenException, Get, Headers, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { UserRequest } from '../common/interfaces/user-request.interface';
import { DashboardService } from './dashboard.service';
import { AdminDashboardQueryDto } from './dto/admin-dashboard-query.dto';
import { createHash, randomUUID } from 'crypto';

@ApiTags('admin-dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get(':userId')
  @ApiOperation({ summary: 'View a user dashboard for an audited support/admin reason' })
  @ApiHeader({ name: 'X-Timezone', required: false })
  async get(@Param('userId', new ParseUUIDPipe()) targetUserId: string, @Query() query: AdminDashboardQueryDto, @GetCurrentUser() actor: UserRequest, @Headers('x-timezone') timezone: string | undefined, @Headers('accept-language') locale: string | undefined, @Headers('x-request-id') requestId: string | undefined, @Req() request: Request) {
    if (!actor.roles.some(role => role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'SYSTEM')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Administrative role is required' });
    const ipHash = request.ip ? `sha256:${createHash('sha256').update(request.ip).digest('hex')}` : undefined;
    return this.dashboard.getForAdmin(actor.userId, targetUserId, timezone, locale, requestId || `req_${randomUUID()}`, query.reason, ipHash);
  }
}
