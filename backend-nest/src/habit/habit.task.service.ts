import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { HabitRepository } from './habit.repository';
import { Habit, HabitStatus } from './habit.entity';

@Injectable()
export class HabitTaskService {
  constructor(@InjectRepository(HabitRepository)
    private readonly habitRepository: HabitRepository,
  ) {}

  async generateDailyTasks(habitId: string): Promise<void> {
    // TODO: Generate daily tasks for the habit
  }

  async completeTask(taskId: string): Promise<void> {
    // TODO: Complete the task
  }

  async skipTask(taskId: string): Promise<void> {
    // TODO: Skip the task
  }

  async getStreak(habitId: string): Promise<number> {
    // TODO: Calculate the streak for the habit
    return 0;
  }

  async updateStreak(habitId: string, streak: number): Promise<void> {
    // TODO: Update the streak for the habit
  }

  async updateBestStreak(habitId: string, bestStreak: number): Promise<void> {
    // TODO: Update the best streak for the habit
  }
}