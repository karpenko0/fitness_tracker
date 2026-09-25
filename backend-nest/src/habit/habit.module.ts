import { Module } from '@nestjs/common';
import { IdempotencyService } from '../common/services/idempotency.service';
import { HabitController } from './habit.controller';
import { HabitService } from './habit.service';
import { HabitTaskService } from './habit-task.service';
import { HabitValidationService } from './habit-validation.service';
import { HabitLocalDateService } from './habit-local-date.service';
import { HabitStreakService } from './habit-streak.service';
import { HabitTaskGenerationWorker } from './workers/habit-task-generation.worker';
import { HabitExpireWorker } from './workers/habit-expire.worker';
import { HabitReminderWorker } from './workers/habit-reminder.worker';
import { TelegramBotClient } from './telegram/telegram-bot.client';
import { HabitNotificationService } from './telegram/habit-notification.service';
import { HabitCallbackService } from './telegram/habit-callback.service';
import { HabitCallbackController } from './telegram/habit-callback.controller';

@Module({
  controllers: [HabitController, HabitCallbackController],
  providers: [
    HabitService,
    HabitTaskService,
    HabitValidationService,
    HabitLocalDateService,
    HabitStreakService,
    IdempotencyService,
    HabitTaskGenerationWorker,
    HabitExpireWorker,
    HabitReminderWorker,
    TelegramBotClient,
    HabitNotificationService,
    HabitCallbackService,
  ],
  exports: [HabitService, HabitTaskService, HabitValidationService, HabitLocalDateService, HabitStreakService, HabitNotificationService],
})
export class HabitModule {}
