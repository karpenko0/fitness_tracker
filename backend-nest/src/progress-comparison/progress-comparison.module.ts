import { Module } from '@nestjs/common';
import { ProgressComparisonService } from './progress-comparison.service';
import { ProgressComparisonController } from './progress-comparison.controller';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ProgressComparisonController],
  providers: [ProgressComparisonService],
})
export class ProgressComparisonModule {}