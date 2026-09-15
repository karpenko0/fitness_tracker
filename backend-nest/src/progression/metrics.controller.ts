import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ProgressionMetricsService } from './progression-metrics.service';

@ApiExcludeController()
@Controller('metrics')
export class ProgressionMetricsController {
  constructor(private readonly metrics: ProgressionMetricsService) {}
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  scrape() { return this.metrics.toPrometheus(); }
}
