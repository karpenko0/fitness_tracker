import { Controller, Post, Body, Patch, Param, Get, Put } from '@nestjs/common';
import { HabitService } from './habit.service';
import { CreateHabitDto } from './dto/create-habit.dto';
import { UpdateHabitDto } from './dto/update-habit.dto';

@Controller('habits')
export class HabitController {
  constructor(private readonly habitService: HabitService) {}

  @Post()
  create(@Body() createHabitDto: CreateHabitDto): Promise<Habit> {
    return this.habitService.create(createHabitDto);
  }

  @Get()
  findAll(): Promise<Habit[]> {
    return this.habitService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Habit> {
    return this.habitService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateHabitDto: UpdateHabitDto): Promise<Habit> {
    return this.habitService.update(id, updateHabitDto);
  }

  @Put(':id/pause')
  pause(@Param('id') id: string): Promise<void> {
    return this.habitService.pause(id);
  }

  @Put(':id/resume')
  resume(@Param('id') id: string): Promise<void> {
    return this.habitService.resume(id);
  }

  @Put(':id/archive')
  archive(@Param('id') id: string): Promise<void> {
    return this.habitService.archive(id);
  }

  @Get('today')
  getToday(): Promise<Habit[]> {
    return this.habitService.getToday();
  }
}