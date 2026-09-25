import { Module } from '@nestjs/common';
import { IdempotencyService } from '../common/services/idempotency.service';
import { HabitController } from './habit.controller';
import { HabitService } from './habit.service';
import { HabitValidationService } from './habit-validation.service';

@Module({
  controllers: [HabitController],
  providers: [HabitService, HabitValidationService, IdempotencyService],
  exports: [HabitService, HabitValidationService],
})
export class HabitModule {}
