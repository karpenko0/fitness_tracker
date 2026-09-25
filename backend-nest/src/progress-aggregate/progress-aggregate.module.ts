import { Module } from '@nestjs/common';
import { ProgressAggregateService } from './progress-aggregate.service';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ProgressAggregateService],
  exports: [ProgressAggregateService],
})
export class ProgressAggregateModule {}