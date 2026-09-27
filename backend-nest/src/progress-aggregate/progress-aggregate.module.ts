import { forwardRef, Module } from '@nestjs/common';
import { ProgressAggregateService } from './progress-aggregate.service';
import { PrismaModule } from '../prisma.module';
import { ProgressionModule } from '../progression/progression.module';
import { WorkoutModule } from '../workout/workout.module';

@Module({
  imports: [PrismaModule, forwardRef(() => ProgressionModule), WorkoutModule],
  providers: [ProgressAggregateService],
  exports: [ProgressAggregateService],
})
export class ProgressAggregateModule {}
