import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { UserRequest } from '../common/interfaces/user-request.interface';
import { ProgressionService } from './progression.service';
import { ExerciseHistoryQueryDto, ExerciseProgressionQueryDto, RecalculateProgressionDto, WeeklyVolumeQueryDto } from './dto/progression-query.dto';

@ApiTags('progression')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/progression')
export class ProgressionController {
  constructor(private readonly progression: ProgressionService) {}

  @Get('exercises/:exerciseId')
  getExercise(@GetCurrentUser() user: UserRequest, @Param('exerciseId', ParseUUIDPipe) exerciseId: string, @Query() query: ExerciseProgressionQueryDto) {
    return this.progression.getExercise(user.userId, exerciseId, Number(query.period.replace('d', '')));
  }

  @Get('exercises/:exerciseId/history')
  history(@GetCurrentUser() user: UserRequest, @Param('exerciseId', ParseUUIDPipe) exerciseId: string, @Query() query: ExerciseHistoryQueryDto) {
    return this.progression.getHistory(user.userId, exerciseId, query.cursor, query.limit, query.from ? new Date(query.from) : undefined, query.to ? new Date(query.to) : undefined);
  }

  @Get('workouts/:workoutId/summary')
  summary(@GetCurrentUser() user: UserRequest, @Param('workoutId', ParseUUIDPipe) workoutId: string) { return this.progression.getSummary(user.userId, workoutId); }

  @Get('volume/weekly')
  weeklyVolume(@GetCurrentUser() user: UserRequest, @Query() query: WeeklyVolumeQueryDto) { return this.progression.getWeeklyVolume(user.userId, query.date ? new Date(query.date) : new Date()); }

  @Post('workouts/:workoutId/recalculate')
  recalculate(@GetCurrentUser() user: UserRequest, @Param('workoutId', ParseUUIDPipe) workoutId: string, @Body() body: RecalculateProgressionDto, @Headers('idempotency-key') key?: string) {
    return this.progression.recalculate(user, workoutId, body, key);
  }
}
