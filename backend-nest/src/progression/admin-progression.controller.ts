import { Body, Controller, ForbiddenException, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { createHash, randomUUID } from 'crypto';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { UserRequest } from '../common/interfaces/user-request.interface';
import { ExerciseHistoryQueryDto, ExerciseProgressionQueryDto } from './dto/progression-query.dto';
import { ProgressionService } from './progression.service';

class RevokePersonalRecordDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reason = 'ADMIN_CORRECTION';
}

@ApiTags('admin-progression')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/admin/progression')
export class AdminProgressionController {
  constructor(private readonly progression: ProgressionService) {}

  @Get('users/:userId/exercises/:exerciseId')
  async get(@Param('userId', ParseUUIDPipe) targetUserId: string, @Param('exerciseId', ParseUUIDPipe) exerciseId: string, @Query() query: ExerciseProgressionQueryDto, @GetCurrentUser() actor: UserRequest, @Headers('x-request-id') requestId: string | undefined, @Req() request: Request) {
    if (!actor.roles.some(role => role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'SYSTEM')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Administrative role is required' });
    const ipHash = request.ip ? `sha256:${createHash('sha256').update(request.ip).digest('hex')}` : undefined;
    return this.progression.getExerciseForAdmin(actor.userId, targetUserId, exerciseId, Number(query.period.replace('d', '')), requestId || `req_${randomUUID()}`, ipHash);
  }

  @Get('users/:userId/exercises/:exerciseId/history')
  async history(@Param('userId', ParseUUIDPipe) targetUserId: string, @Param('exerciseId', ParseUUIDPipe) exerciseId: string, @Query() query: ExerciseHistoryQueryDto, @GetCurrentUser() actor: UserRequest, @Headers('x-request-id') requestId: string | undefined, @Req() request: Request) {
    this.requireAdmin(actor);
    return this.progression.getHistoryForAdmin(actor.userId, targetUserId, exerciseId, query, this.meta(request, requestId));
  }

  @Get('users/:userId/workouts/:workoutId/summary')
  async summary(@Param('userId', ParseUUIDPipe) targetUserId: string, @Param('workoutId', ParseUUIDPipe) workoutId: string, @GetCurrentUser() actor: UserRequest, @Headers('x-request-id') requestId: string | undefined, @Req() request: Request) {
    this.requireAdmin(actor);
    return this.progression.getSummaryForAdmin(actor.userId, targetUserId, workoutId, this.meta(request, requestId));
  }

  @Post('personal-records/:recordId/revoke')
  async revoke(@Param('recordId', ParseUUIDPipe) recordId: string, @Body() body: RevokePersonalRecordDto, @GetCurrentUser() actor: UserRequest, @Headers('x-request-id') requestId: string | undefined, @Req() request: Request) {
    this.requireAdmin(actor);
    return this.progression.revokePersonalRecord(actor.userId, recordId, body.reason, this.meta(request, requestId));
  }

  private requireAdmin(actor: UserRequest) {
    if (!actor.roles.some(role => role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'SYSTEM')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Administrative role is required' });
  }

  private meta(request: Request, requestId?: string) {
    return { requestId: requestId || `req_${randomUUID()}`, ipHash: request.ip ? `sha256:${createHash('sha256').update(request.ip).digest('hex')}` : undefined };
  }
}
