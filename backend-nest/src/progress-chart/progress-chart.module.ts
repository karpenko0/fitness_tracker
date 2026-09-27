import { Module } from '@nestjs/common';
import { ProgressChartService } from './progress-chart.service';
import { ProgressChartController } from './progress-chart.controller';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ProgressChartController],
  providers: [ProgressChartService],
})
export class ProgressChartModule {}