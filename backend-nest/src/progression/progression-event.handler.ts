import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ProgressionService } from './progression.service';
import { ProgressAggregateService } from '../progress-aggregate/progress-aggregate.service';

/** Idempotent consumer entry point for transactional-outbox delivery. */
@Injectable()
export class ProgressionEventHandler {
  private readonly logger = new Logger(ProgressionEventHandler.name);

  constructor(
    private readonly progression: ProgressionService,
    private readonly progressAggregateService: ProgressAggregateService,
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
  ) {}

  async handleEvent(payload: any, type: string) {
    try {
      switch (type) {
        case 'workout.completed':
          return this.handleWorkoutCompleted(payload);
        case 'progression.workout_calculated':
          return this.handleProgressionWorkoutCalculated(payload);
        default:
          this.logger.warn(`Unknown event type: ${type}`);
          return null;
      }
    } catch (error) {
      this.logger.error(`Error handling event ${type}:`, error);
      throw error;
    }
  }

  async handleWorkoutCompleted(payload: { workoutId: string }) {
    this.logger.log(`Processing workout.completed event for workoutId: ${payload.workoutId}`);
    
    // Получаем информацию о тренировке для определения пользователя и даты
    const workout = await this.prisma.workout.findUnique({
      where: { id: payload.workoutId },
      select: { userId: true, completedAt: true },
    });

    if (!workout) {
      this.logger.error(`Workout not found: ${payload.workoutId}`);
      return null;
    }

    // Рассчитываем агрегаты для даты завершения тренировки
    // Используем локальную дату пользователя (пока просто используем completedAt)
    // TODO: Нужно получить таймзону пользователя и перевести в локальную дату
    const targetDate = new Date(workout.completedAt);
    await this.progressAggregateService.calculateAndSaveAggregates(workout.userId, targetDate);

    return { success: true };
  }

  async handleProgressionWorkoutCalculated(payload: { workoutId: string; algorithmVersion: string }) {
    this.logger.log(`Processing progression.workout_calculated event for workoutId: ${payload.workoutId}`);
    return this.progression.calculateCompletedWorkout(payload.workoutId, payload.algorithmVersion);
  }
}