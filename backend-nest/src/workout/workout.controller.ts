import { Controller, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { UserRequest } from '../common/interfaces/user-request.interface';
import { WorkoutService } from './workout.service';

@ApiTags('workouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/workouts')
export class WorkoutController {
  constructor(private readonly workouts: WorkoutService) {}
  @Post(':workoutId/start')
  @ApiOperation({ summary: 'Start a planned workout' })
  start(@Param('workoutId') id: string, @GetCurrentUser() user: UserRequest, @Headers('idempotency-key') key?: string) { return this.workouts.transition(user.userId, id, 'start', key); }
  @Post(':workoutId/pause')
  @ApiOperation({ summary: 'Pause an active workout' })
  pause(@Param('workoutId') id: string, @GetCurrentUser() user: UserRequest, @Headers('idempotency-key') key?: string) { return this.workouts.transition(user.userId, id, 'pause', key); }
  @Post(':workoutId/resume')
  @ApiOperation({ summary: 'Resume a paused workout' })
  resume(@Param('workoutId') id: string, @GetCurrentUser() user: UserRequest, @Headers('idempotency-key') key?: string) { return this.workouts.transition(user.userId, id, 'resume', key); }
  @Post(':workoutId/complete')
  @ApiOperation({ summary: 'Complete an active workout' })
  complete(@Param('workoutId') id: string, @GetCurrentUser() user: UserRequest, @Headers('idempotency-key') key?: string) { return this.workouts.transition(user.userId, id, 'complete', key); }
}
