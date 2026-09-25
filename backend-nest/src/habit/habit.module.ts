import { Module } from '@nestjs/common';
import { IdempotencyService } from '../common/services/idempotency.service';
import { HabitController } from './habit.controller';
import { HabitService } from './habit.service';
import { HabitTaskService } from './habit-task.service';
import { HabitValidationService } from './habit-validation.service';
import { HabitLocalDateService } from './habit-local-date.service';
import { HabitTaskGenerationWorker } from './workers/habit-task-generation.worker';
import { HabitExpireWorker } from './workers/habit-expire.worker';

@Module({
  controllers: [HabitController],
  providers: [
    HabitService,
    HabitTaskService,
    HabitValidationService,
    HabitLocalDateService,
    IdempotencyService,
    HabitTaskGenerationWorker,
    HabitExpireWorker,
  ],
  exports: [HabitService, HabitTaskService, HabitValidationService, HabitLocalDateService],
})
export class HabitModule {}
