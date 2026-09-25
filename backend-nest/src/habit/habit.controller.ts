import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CreateHabitDto, UpdateHabitDto } from './dto/create-habit.dto';
import { ListHabitsQueryDto } from './dto/list-habits-query.dto';
import { HabitService } from './habit.service';

@ApiTags('habits')
@ApiBearerAuth()
@Controller('api/v1/habits')
@UseGuards(AuthGuard('jwt'))
export class HabitController {
  constructor(private readonly habitService: HabitService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Создать привычку' })
  create(
    @Request() req: any,
    @Body() dto: CreateHabitDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.habitService.create(req.user.userId, dto, idempotencyKey);
  }

  @Get()
  @ApiOperation({ summary: 'Список привычек пользователя' })
  list(@Request() req: any, @Query() query: ListHabitsQueryDto) {
    return this.habitService.list(req.user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Привычка по id (только своя)' })
  get(@Request() req: any, @Param('id') id: string) {
    return this.habitService.get(req.user.userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить привычку (optimistic locking по version)' })
  update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateHabitDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.habitService.update(req.user.userId, id, dto, idempotencyKey);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Поставить привычку на паузу' })
  pause(
    @Request() req: any,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.habitService.pause(req.user.userId, id, idempotencyKey);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Возобновить привычку' })
  resume(
    @Request() req: any,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.habitService.resume(req.user.userId, id, idempotencyKey);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Архивировать привычку' })
  archive(
    @Request() req: any,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.habitService.archive(req.user.userId, id, idempotencyKey);
  }
}
