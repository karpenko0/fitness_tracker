import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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

  @Post()
  create(@GetCurrentUser() user: UserRequest, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.workouts.create(user.userId, body, key); }

  @Get(':workoutId')
  get(@Param('workoutId') id: string, @GetCurrentUser() user: UserRequest) { return this.workouts.get(user.userId, id); }

  @Post(':workoutId/start')
  start(@Param('workoutId') id: string, @GetCurrentUser() user: UserRequest, @Headers('idempotency-key') key?: string) { return this.workouts.transition(user.userId, id, 'start', key); }

  @Post(':workoutId/pause')
  pause(@Param('workoutId') id: string, @GetCurrentUser() user: UserRequest, @Headers('idempotency-key') key?: string) { return this.workouts.transition(user.userId, id, 'pause', key); }

  @Post(':workoutId/resume')
  resume(@Param('workoutId') id: string, @GetCurrentUser() user: UserRequest, @Headers('idempotency-key') key?: string) { return this.workouts.transition(user.userId, id, 'resume', key); }

  @Patch(':workoutId/exercises/:exerciseId/sets/:setId')
  updateSet(@Param('workoutId') workoutId: string, @Param('exerciseId') exerciseId: string, @Param('setId') setId: string, @GetCurrentUser() user: UserRequest, @Body() body: any) { return this.workouts.updateSet(user.userId, workoutId, exerciseId, setId, body); }

  @Post(':workoutId/exercises/:exerciseId/sets')
  addSet(@Param('workoutId') workoutId: string, @Param('exerciseId') exerciseId: string, @GetCurrentUser() user: UserRequest, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.workouts.addSet(user.userId, workoutId, exerciseId, body, key); }

  @Delete(':workoutId/exercises/:exerciseId/sets/:setId')
  deleteSet(@Param('workoutId') workoutId: string, @Param('exerciseId') exerciseId: string, @Param('setId') setId: string, @GetCurrentUser() user: UserRequest, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.workouts.deleteSet(user.userId, workoutId, exerciseId, setId, body, key); }

  @Post(':workoutId/exercises/:exerciseId/sets/:setId/skip')
  skipSet(@Param('workoutId') workoutId: string, @Param('exerciseId') exerciseId: string, @Param('setId') setId: string, @GetCurrentUser() user: UserRequest, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.workouts.skipSet(user.userId, workoutId, exerciseId, setId, body, key); }

  @Post(':workoutId/exercises/:exerciseId/sets/:setId/restore')
  restoreSet(@Param('workoutId') workoutId: string, @Param('exerciseId') exerciseId: string, @Param('setId') setId: string, @GetCurrentUser() user: UserRequest, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.workouts.restoreSet(user.userId, workoutId, exerciseId, setId, body, key); }

  @Post(':workoutId/exercises')
  addExercise(@Param('workoutId') workoutId: string, @GetCurrentUser() user: UserRequest, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.workouts.addExercise(user.userId, workoutId, body, key); }

  @Delete(':workoutId/exercises/:exerciseId')
  deleteExercise(@Param('workoutId') workoutId: string, @Param('exerciseId') exerciseId: string, @GetCurrentUser() user: UserRequest, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.workouts.deleteExercise(user.userId, workoutId, exerciseId, body, key); }

  @Post(':workoutId/exercises/:exerciseId/replace')
  replaceExercise(@Param('workoutId') workoutId: string, @Param('exerciseId') exerciseId: string, @GetCurrentUser() user: UserRequest, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.workouts.replaceExercise(user.userId, workoutId, exerciseId, body, key); }

  @Post(':workoutId/rest-timer/:action')
  restTimer(@Param('workoutId') workoutId: string, @Param('action') action: 'start' | 'pause' | 'resume' | 'skip' | 'extend', @GetCurrentUser() user: UserRequest, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.workouts.restTimer(user.userId, workoutId, action, body, key); }

  @Post(':workoutId/cancel')
  cancel(@Param('workoutId') workoutId: string, @GetCurrentUser() user: UserRequest, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.workouts.cancel(user.userId, workoutId, body, key); }

  @Post(':workoutId/complete')
  complete(@Param('workoutId') id: string, @GetCurrentUser() user: UserRequest, @Body() body: any, @Headers('idempotency-key') key?: string) { return this.workouts.complete(user.userId, id, body, key); }
}
