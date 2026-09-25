import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PrismaClient, ProgressAggregateDimensionType, ProgressAggregateGroupBy, ProgressAggregateMetric, ProgressAggregateUnit } from '@prisma/client';
import { ProgressionService } from '../progression/progression.service';
import { WorkoutService } from '../workout/workout.service';

@Injectable()
export class ProgressAggregateService {
  private readonly logger = new Logger(ProgressAggregateService.name);

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    private readonly progressionService: ProgressionService,
    private readonly workoutService: WorkoutService,
  ) {}

  /**
   * Рассчитывает и сохраняет агрегаты для пользователя за указанную дату
   * Вызывается асинхронно после завершения тренировки
   */
  async calculateAndSaveAggregates(userId: string, targetDate: Date): Promise<void> {
    try {
      this.logger.log(`Calculating aggregates for user ${userId} for date ${targetDate}`);

      // Очищаем существующие агрегаты за эту дату для пользователя (пересчёт)
      await this.prisma.progressAggregate.deleteMany({
        where: {
          userId,
          localDate: targetDate,
        },
      });

      // Рассчитываем разные типы агрегатов
      await this.calculateVolumeAggregates(userId, targetDate);
      await this.calculateWorkingWeightAggregates(userId, targetDate);
      await this.calculateEstimated1RMAggregates(userId, targetDate);
      await this.calculateBodyMeasurementAggregates(userId, targetDate);

      this.logger.log(`Aggregates calculated and saved for user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to calculate aggregates for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Рассчитывает агрегаты объёма тренировок
   * VOLUME = Σ(actualWeightKg × actualReps) для завершенных подходов
   */
  private async calculateVolumeAggregates(userId: string, targetDate: Date): Promise<void> {
    // Глобальный объём за день
    const globalVolume = await this.calculateDailyVolume(userId, targetDate);
    if (globalVolume !== null) {
      await this.saveAggregate(
        userId,
        'VOLUME',
        'GLOBAL',
        null,
        null,
        targetDate,
        'DAY',
        globalVolume,
        'KG',
      );
    }

    // Объём по программам
    const programVolumes = await this.calculateVolumeByProgram(userId, targetDate);
    for (const { programId, volume } of programVolumes) {
      await this.saveAggregate(
        userId,
        'VOLUME',
        'PROGRAM',
        programId,
        null,
        targetDate,
        'DAY',
        volume,
        'KG',
      );
    }

    // Объём по упражнениям
    const exerciseVolumes = await this.calculateVolumeByExercise(userId, targetDate);
    for (const { exerciseId, volume } of exerciseVolumes) {
      await this.saveAggregate(
        userId,
        'VOLUME',
        'EXERCISE',
        exerciseId,
        null,
        targetDate,
        'DAY',
        volume,
        'KG',
      );
    }

    // Объём по мышечным группам
    const muscleGroupVolumes = await this.calculateVolumeByMuscleGroup(userId, targetDate);
    for (const { muscleGroup, volume } of muscleGroupVolumes) {
      await this.saveAggregate(
        userId,
        'VOLUME',
        'MUSCLE_GROUP',
        null,
        muscleGroup,
        targetDate,
        'DAY',
        volume,
        'KG',
      );
    }
  }

  /**
   * Рассчитывает дневной объём тренировок для пользователя
   */
  private async calculateDailyVolume(userId: string, targetDate: Date): Promise<number | null> {
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const workouts = await this.prisma.workout.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        completedAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
      include: {
        exercises: {
          include: {
            sets: true,
          },
        },
      },
    });

    let totalVolume = 0;
    let hasData = false;

    for (const workout of workouts) {
      for (const exercise of workout.exercises) {
        for (const set of exercise.sets) {
          if (set.status === 'COMPLETED' && set.actualWeightKg !== null && set.actualReps !== null) {
            const volume = Number(set.actualWeightKg) * Number(set.actualReps);
            totalVolume += volume;
            hasData = true;
          }
        }
      }
    }

    return hasData ? totalVolume : null;
  }

  /**
   * Рассчитывает объём тренировок по программам
   */
  private async calculateVolumeByProgram(userId: string, targetDate: Date): Promise<Array<{ programId: string; volume: number }>> {
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const workouts = await this.prisma.workout.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        completedAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
        programAssignmentId: {
          not: null,
        },
      },
      include: {
        exercises: {
          include: {
            sets: true,
          },
        },
        programAssignment: {
          include: {
            program: true,
          },
        },
      },
    });

    const programVolumes = new Map<string, number>();

    for (const workout of workouts) {
      const programId = workout.programAssignment?.programId;
      if (!programId) continue;

      let programVolume = programVolumes.get(programId) || 0;

      for (const exercise of workout.exercises) {
        for (const set of exercise.sets) {
          if (set.status === 'COMPLETED' && set.actualWeightKg !== null && set.actualReps !== null) {
            const volume = Number(set.actualWeightKg) * Number(set.actualReps);
            programVolume += volume;
          }
        }
      }

      programVolumes.set(programId, programVolume);
    }

    return Array.from(programVolumes.entries()).filter(([, volume]) => volume > 0).map(([programId, volume]) => ({
      programId,
      volume,
    }));
  }

  /**
   * Рассчитывает объём тренировок по упражнениям
   */
  private async calculateVolumeByExercise(userId: string, targetDate: Date): Promise<Array<{ exerciseId: string; volume: number }>> {
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const workouts = await this.prisma.workout.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        completedAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
      include: {
        exercises: {
          include: {
            sets: true,
          },
        },
      },
    });

    const exerciseVolumes = new Map<string, number>();

    for (const workout of workouts) {
      for (const exercise of workout.exercises) {
        const exerciseId = exercise.id;
        let exerciseVolume = exerciseVolumes.get(exerciseId) || 0;

        for (const set of exercise.sets) {
          if (set.status === 'COMPLETED' && set.actualWeightKg !== null && set.actualReps !== null) {
            const volume = Number(set.actualWeightKg) * Number(set.actualReps);
            exerciseVolume += volume;
          }
        }

        exerciseVolumes.set(exerciseId, exerciseVolume);
      }
    }

    return Array.from(exerciseVolumes.entries()).filter(([, volume]) => volume > 0).map(([exerciseId, volume]) => ({
      exerciseId,
      volume,
    }));
  }

  /**
   * Рассчитывает объём тренировок по мышечным группам
   */
  private async calculateVolumeByMuscleGroup(userId: string, targetDate: Date): Promise<Array<{ muscleGroup: string; volume: number }>> {
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const workouts = await this.prisma.workout.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        completedAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
      include: {
        exercises: {
          include: {
            sets: true,
          },
        },
      },
    });

    const muscleGroupVolumes = new Map<string, number>();

    for (const workout of workouts) {
      for (const exercise of workout.exercises) {
        if (!exercise.catalogExerciseId) continue;
        // Получаем мышечные группы упражнения из каталога
        const exerciseWithMuscles = await this.prisma.exerciseCatalogItem.findUnique({
          where: { id: exercise.catalogExerciseId },
          include: {
            muscleLinks: true,
          },
        });

        if (!exerciseWithMuscles) continue;

        const muscleGroups = exerciseWithMuscles.muscleLinks
          .map(link => link.muscle)
          .filter((muscle, index, self) => self.indexOf(muscle) === index); // Уникальные группы

        for (const set of exercise.sets) {
          if (set.status === 'COMPLETED' && set.actualWeightKg !== null && set.actualReps !== null) {
            const volume = Number(set.actualWeightKg) * Number(set.actualReps);
            for (const muscleGroup of muscleGroups) {
              const currentVolume = muscleGroupVolumes.get(muscleGroup) || 0;
              muscleGroupVolumes.set(muscleGroup, currentVolume + volume);
            }
          }
        }
      }
    }

    return Array.from(muscleGroupVolumes.entries()).filter(([, volume]) => volume > 0).map(([muscleGroup, volume]) => ({
      muscleGroup,
      volume,
    }));
  }

  /**
   * Рассчитывает агрегаты рабочих весов
   * Для каждого упражнения в тренировке: max рабочий вес, средний рабочий вес, количество рабочих подходов
   * Исключаем разминочные подходы (WARMUP)
   */
  private async calculateWorkingWeightAggregates(userId: string, targetDate: Date): Promise<void> {
    // Реализация аналогичная объёму, но для рабочих весов
    // TODO: Implement working weight calculations
  }

  /**
   * Рассчитывает агрегаты estimated 1RM
   * Formula: weightKg × (1 + reps / 30)
   * Только для подходов с 1-12 повторами
   * Берём максимум за тренировку по упражнению
   */
  private async calculateEstimated1RMAggregates(userId: string, targetDate: Date): Promise<void> {
    // TODO: Implement 1RM calculations
  }

  /**
   * Рассчитывает агрегаты измерений тела (вес, окружности)
   * Берем измерения за указанную дату
   */
  private async calculateBodyMeasurementAggregates(userId: string, targetDate: Date): Promise<void> {
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const measurements = await this.prisma.measurement.findMany({
      where: {
        userId,
        measuredAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
      },
      include: {
        values: true,
      },
    });

    for (const measurement of measurements) {
      for (const value of measurement.values) {
        let unit: 'KG' | 'CM';
        if (value.metric === 'WEIGHT') {
          unit = 'KG';
        } else {
          unit = 'CM';
        }

        await this.saveAggregate(
          userId,
          value.metric as any, // TODO: proper typing
          'GLOBAL',
          null,
          null,
          new Date(measurement.measuredAt),
          'DAY',
          value.value == null ? null : Number(value.value),
          unit,
        );
      }
    }
  }

  /**
   * Сохраняет один агрегат в БД
   */
  private async saveAggregate(
    userId: string,
    metric: string,
    dimensionType: string,
    dimensionId: string | null,
    dimensionCode: string | null,
    localDate: Date,
    groupBy: string,
    value: number | null,
    unit: string,
  ): Promise<void> {
    if (value === null) {
      // Не сохраняем агрегаты с null значениями согласно спецификации
      return;
    }

    await this.prisma.progressAggregate.create({
      data: {
        userId,
        metric: metric as ProgressAggregateMetric,
        dimensionType: dimensionType as ProgressAggregateDimensionType,
        dimensionId,
        dimensionCode,
        localDate: new Date(localDate),
        groupBy: groupBy as ProgressAggregateGroupBy,
        value,
        unit: unit as ProgressAggregateUnit,
        calculationVersion: '1.0.0', // TODO: сделать конфигурируемым
        calculatedAt: new Date(),
      },
    });
  }
}