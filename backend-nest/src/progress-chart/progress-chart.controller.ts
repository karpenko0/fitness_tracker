import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { ProgressChartService } from './progress-chart.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('progress-chart')
@UseGuards(AuthGuard('jwt'))
export class ProgressChartController {
  constructor(private progressChartService: ProgressChartService) {}

  @Get()
  async getChartData(
    @Request() req,
    @Query('metric') metric: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('programId') programId?: string,
    @Query('exerciseId') exerciseId?: string,
    @Query('muscleGroup') muscleGroup?: string,
    @Query('muscleMatch') muscleMatch?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    // Устанавливаем значения по умолчанию
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Последние 30 дней
    const toDate = to ? new Date(to) : new Date();
    const groupByValue = groupBy || 'DAY';

    return this.progressChartService.getChartData(req.user.userId, {
      metric,
      programId,
      exerciseId,
      muscleGroup,
      muscleMatch,
      groupBy: groupByValue,
      from: fromDate,
      to: toDate,
    });
  }
}