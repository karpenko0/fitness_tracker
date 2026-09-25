import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HabitTaskService } from '../habit-task.service';

/**
 * Ежечасно создаёт задания на локальную дату для активных привычек.
 * Идемпотентен: повторный запуск не создаёт дублей (upsert по habitId+localDate).
 * PAUSED/ARCHIVED привычки пропускаются внутри HabitTaskService.
 */
@Injectable()
export class HabitTaskGenerationWorker {
  private readonly logger = new Logger(HabitTaskGenerationWorker.name);

  constructor(private readonly tasks: HabitTaskService) {}

  @Cron('0 * * * *', { name: 'habit-task-generation' })
  async handleCron(): Promise<void> {
    try {
      const ensured = await this.tasks.generateForAllActiveHabits();
      if (ensured > 0) this.logger.log(`Generated/ensured tasks for ${ensured} habits`);
    } catch (error) {
      this.logger.error('Habit task generation failed', error as Error);
    }
  }
}
