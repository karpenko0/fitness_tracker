import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { UserRequest } from '../common/interfaces/user-request.interface';
import { AddProgramExerciseDto, CreateProgramDayDto, CreateProgramDto, ProgramQueryDto, ReorderDto, UpdateProgramDto, VersionedDto } from './dto/program.dto';
import { ProgramService } from './program.service';

@ApiTags('programs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/programs')
export class ProgramController {
  constructor(private readonly programs: ProgramService) {}

  @Get()
  list(@GetCurrentUser() user: UserRequest, @Query() query: ProgramQueryDto) {
    return this.programs.list(user.userId, query);
  }

  @Get('me/active')
  active(@GetCurrentUser() user: UserRequest) {
    return this.programs.active(user.userId);
  }

  @Get(':programId')
  get(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string) {
    return this.programs.get(user.userId, programId);
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(@GetCurrentUser() user: UserRequest, @Body() dto: CreateProgramDto, @Headers('idempotency-key') key?: string) {
    return this.programs.create(user.userId, dto, key);
  }

  @Patch(':programId')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  update(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string, @Body() dto: UpdateProgramDto, @Headers('idempotency-key') key?: string) {
    return this.programs.update(user.userId, programId, dto, key);
  }

  @Post(':programId/days')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  addDay(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string, @Body() dto: CreateProgramDayDto, @Headers('idempotency-key') key?: string) {
    return this.programs.addDay(user.userId, programId, dto, key);
  }

  @Post(':programId/days/:dayId/exercises')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  addExercise(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string, @Param('dayId', ParseUUIDPipe) dayId: string, @Body() dto: AddProgramExerciseDto, @Headers('idempotency-key') key?: string) {
    return this.programs.addExercise(user.userId, programId, dayId, dto, key);
  }

  @Patch(':programId/days/reorder')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  reorderDays(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string, @Body() dto: ReorderDto, @Headers('idempotency-key') key?: string) {
    return this.programs.reorderDays(user.userId, programId, dto, key);
  }

  @Patch(':programId/days/:dayId/exercises/reorder')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  reorderExercises(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string, @Param('dayId', ParseUUIDPipe) dayId: string, @Body() dto: ReorderDto, @Headers('idempotency-key') key?: string) {
    return this.programs.reorderExercises(user.userId, programId, dayId, dto, key);
  }

  @Post(':programId/days/:dayId/duplicate')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  duplicateDay(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string, @Param('dayId', ParseUUIDPipe) dayId: string, @Body() dto: VersionedDto, @Headers('idempotency-key') key?: string) {
    return this.programs.duplicateDay(user.userId, programId, dayId, dto, key);
  }

  @Post(':programId/days/:dayId/exercises/:exerciseId/duplicate')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  duplicateExercise(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string, @Param('dayId', ParseUUIDPipe) dayId: string, @Param('exerciseId', ParseUUIDPipe) exerciseId: string, @Body() dto: VersionedDto, @Headers('idempotency-key') key?: string) {
    return this.programs.duplicateExercise(user.userId, programId, dayId, exerciseId, dto, key);
  }

  @Delete(':programId/days/:dayId')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  deleteDay(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string, @Param('dayId', ParseUUIDPipe) dayId: string, @Body() dto: VersionedDto, @Headers('idempotency-key') key?: string) {
    return this.programs.deleteDay(user.userId, programId, dayId, dto, key);
  }

  @Delete(':programId/days/:dayId/exercises/:exerciseId')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  deleteExercise(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string, @Param('dayId', ParseUUIDPipe) dayId: string, @Param('exerciseId', ParseUUIDPipe) exerciseId: string, @Body() dto: VersionedDto, @Headers('idempotency-key') key?: string) {
    return this.programs.deleteExercise(user.userId, programId, dayId, exerciseId, dto, key);
  }

  @Post(':programId/copy')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  copy(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string, @Headers('idempotency-key') key?: string) {
    return this.programs.copy(user.userId, programId, key);
  }

  @Post(':programId/activate')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  activate(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string, @Headers('idempotency-key') key?: string) {
    return this.programs.activate(user.userId, programId, key);
  }

  @Post(':programId/archive')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  archive(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string, @Headers('idempotency-key') key?: string) {
    return this.programs.archive(user.userId, programId, key);
  }

  @Post(':programId/days/:dayId/start-workout')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  startWorkout(@GetCurrentUser() user: UserRequest, @Param('programId', ParseUUIDPipe) programId: string, @Param('dayId', ParseUUIDPipe) dayId: string, @Headers('idempotency-key') key?: string) {
    return this.programs.startWorkoutFromDay(user.userId, programId, dayId, key);
  }
}
