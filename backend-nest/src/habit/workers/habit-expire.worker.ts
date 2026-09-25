import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HabitTaskService } from '../habit-task.service';

/**
 * Каждые 15 минут переводит незавершённые задания, чей локальный день закончился,
 * в статус EXPIRED. Завершённые (COMPLETED) задания не затрагиваются.
 */
@Injectable()
export class HabitExpireWorker {
  private readonly logger = new Logger(HabitExpireWorker.name);

  constructor(private readonly tasks: HabitTaskService) {}

  @Cron('*/15 * * * *', { name: 'habit-expire' })
  async handleCron(): Promise<void> {
    try {
      const expired = await this.tasks.expireOverdueTasks();
      if (expired > 0) this.logger.log(`Expired ${expired} overdue habit tasks`);
    } catch (error) {
      this.logger.error('Habit expire pass failed', error as Error);
    }
  }
}
