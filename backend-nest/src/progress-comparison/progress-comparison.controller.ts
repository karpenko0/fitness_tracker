import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { ProgressComparisonService } from './progress-comparison.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('api/v1/progress-comparison')
@UseGuards(AuthGuard('jwt'))
export class ProgressComparisonController {
  constructor(private progressComparisonService: ProgressComparisonService) {}

  @Get()
  async comparePeriods(
    @Request() req: any,
    @Query('preset') preset: string,
    @Query('metric') metric: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('programId') programId?: string,
    @Query('exerciseId') exerciseId?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;

    return this.progressComparisonService.comparePeriods(req.user.userId, {
      preset,
      metric,
      programId,
      exerciseId,
      from: fromDate,
      to: toDate,
    });
  }
}