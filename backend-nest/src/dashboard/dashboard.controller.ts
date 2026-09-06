import { Controller, Get, Headers, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { UserRequest } from '../common/interfaces/user-request.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { randomUUID } from 'crypto';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({ summary: 'Get the current user dashboard without changing workout state' })
  @ApiQuery({ name: 'forceRefresh', required: false, type: Boolean })
  @ApiHeader({ name: 'X-Timezone', required: false, description: 'IANA timezone, e.g. Europe/Moscow' })
  @ApiHeader({ name: 'X-Request-Id', required: false })
  @ApiOkResponse({ description: 'Dashboard read model in the standard data envelope' })
  get(@GetCurrentUser() user: UserRequest, @Query() query: DashboardQueryDto, @Headers('x-timezone') timezone: string | undefined, @Headers('accept-language') locale: string | undefined, @Headers('x-request-id') requestId: string | undefined) {
    return this.dashboard.get(user.userId, timezone, locale, query.forceRefresh, requestId || `req_${randomUUID()}`);
  }
}
