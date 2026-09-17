import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetCurrentUser } from '../common/decorators/get-current-user.decorator';
import { UserRequest } from '../common/interfaces/user-request.interface';
import { CreateCustomExerciseDto, ExerciseQueryDto } from './dto/program.dto';
import { ExerciseCatalogService } from './exercise-catalog.service';

@ApiTags('exercises')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/exercises')
export class ExerciseController {
  constructor(private readonly catalog: ExerciseCatalogService) {}

  @Get()
  list(@GetCurrentUser() user: UserRequest, @Query() query: ExerciseQueryDto) {
    return this.catalog.list(user.userId, query);
  }

  @Get(':exerciseId')
  get(@GetCurrentUser() user: UserRequest, @Param('exerciseId', ParseUUIDPipe) exerciseId: string) {
    return this.catalog.get(user.userId, exerciseId);
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(@GetCurrentUser() user: UserRequest, @Body() dto: CreateCustomExerciseDto, @Headers('idempotency-key') key?: string) {
    return this.catalog.createCustom(user.userId, dto, key);
  }
}
