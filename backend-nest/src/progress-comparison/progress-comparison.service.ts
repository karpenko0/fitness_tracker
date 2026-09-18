import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class ProgressComparisonService {
  private readonly logger = new Logger(ProgressComparisonService.name);

  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  /**
   * Checks if the user has Pro subscription
   */
  private async isProUser(userId: string): Promise<boolean> {
    const subscription = await this.prisma.subscriptionEntitlement.findUnique({
      where: { userId },
    });
    
    return subscription?.plan === 'PRO';
  }

  /**
   * Calculates the cutoff date based on user's subscription level
   * For FREE users: 30 days ago
   * For PRO users: no limit (we'll use a very old date to effectively mean no limit)
   */
  private async getCutoffDate(userId: string): Promise<Date> {
    const isPro = await this.isProUser(userId);
    const cutoffDate = new Date();
    
    if (!isPro) {
      // Free users: limit to last 30 days
      cutoffDate.setDate(cutoffDate.getDate() - 30);
    } else {
      // Pro users: effectively no limit (use a date far in the past)
      cutoffDate.setFullYear(cutoffDate.getFullYear() - 10); // 10 years ago
    }
    
    return cutoffDate;
  }

  /**
   * Сравнивает метрики между текущим и предыдущим периодом одинаковой длины
   */
  async comparePeriods(userId: string, options: {
    preset: string; // WEEK, MONTH, CUSTOM
    metric: string;
    programId?: string;
    exerciseId?: string;
    from?: Date;
    to?: Date;
  }) {
    try {
      this.logger.log(`Comparing periods for user ${userId}, metric: ${options.metric}, preset: ${options.preset}`);

      // Валидация параметров
      this.validateCompareOptions(options);

      // Get the cutoff date for the user
      const cutoffDate = await this.getCutoffDate(userId);

      // Определяем периоды
      const { currentPeriod, previousPeriod } = this.determinePeriods(options);

      // Adjust the periods to be within the cutoff date
      const adjustedCurrentPeriod = this.adjustPeriodToCutoff(currentPeriod, cutoffDate);
      const adjustedPreviousPeriod = this.adjustPeriodToCutoff(previousPeriod, cutoffDate);

      // If after adjustment, the period is invalid (from > to), then we treat it as having no data
      const currentValue = adjustedCurrentPeriod.from <= adjustedCurrentPeriod.to 
        ? await this.getPeriodAggregate(userId, {
            ...options,
            from: adjustedCurrentPeriod.from,
            to: adjustedCurrentPeriod.to,
          })
        : null;

      const previousValue = adjustedPreviousPeriod.from <= adjustedPreviousPeriod.to 
        ? await this.getPeriodAggregate(userId, {
            ...options,
            from: adjustedPreviousPeriod.from,
            to: adjustedPreviousPeriod.to,
          })
        : null;

      // Вычисляем изменение
      const comparison = this.calculateComparison(currentValue, previousValue);

      return {
        metric: options.metric,
        unit: this.getUnitForMetric(options.metric),
        currentPeriod: {
          from: adjustedCurrentPeriod.from.toISOString().split('T')[0],
          to: adjustedCurrentPeriod.to.toISOString().split('T')[0],
          value: currentValue,
        },
        previousPeriod: {
          from: adjustedPreviousPeriod.from.toISOString().split('T')[0],
          to: adjustedPreviousPeriod.to.toISOString().split('T')[0],
          value: previousValue,
        },
        comparison,
      };
    } catch (error) {
      this.logger.error(`Error comparing periods:`, error);
      throw error;
    }
  }

  /**
   * Adjusts a period to be within the cutoff date.
   * If the period is entirely before the cutoff date, returns an invalid period (from > to).
   * If the period starts before the cutoff date but ends after, adjusts the from to the cutoff date.
   * If the period is entirely after the cutoff date, returns the period unchanged.
   */
  private adjustPeriodToCutoff(period: { from: Date; to: Date }, cutoffDate: Date) {
    // If the entire period is before the cutoff date, return an invalid period
    if (period.to < cutoffDate) {
      return { from: new Date(cutoffDate.getTime() + 1), to: new Date(cutoffDate.getTime()) }; // from > to
    }
    
    // If the period starts before the cutoff date, adjust the from to the cutoff date
    if (period.from < cutoffDate) {
      return { from: new Date(cutoffDate.getTime()), to: period.to };
    }
    
    // Otherwise, the period is entirely after the cutoff date, return as is
    return period;
  }

  /**
   * Валидирует параметры запроса сравнения
   */
  private validateCompareOptions(options: {
    preset: string;
    metric: string;
    from?: Date;
    to?: Date;
  }): void {
    const validPresets = ['WEEK', 'MONTH', 'CUSTOM'];
    if (!validPresets.includes(options.preset)) {
      throw new Error(`Invalid preset: ${options.preset}`);
    }

    const validMetrics = ['VOLUME', 'WORKING_WEIGHT', 'ESTIMATED_1RM', 'BODY_WEIGHT', 'NECK', 'CHEST', 'WAIST', 'ABDOMEN', 'HIPS', 'BICEPS_LEFT', 'BICEPS_RIGHT', 'THIGH_LEFT', 'THIGH_RIGHT', 'CALF_LEFT', 'CALF_RIGHT'];
    if (!validMetrics.includes(options.metric)) {
      throw new Error(`Invalid metric: ${options.metric}`);
    }

    if (options.preset === 'CUSTOM') {
      if (!options.from || !options.to) {
        throw new Error('From and to dates are required for CUSTOM preset');
      }
      if (options.from > options.to) {
        throw new Error('From date cannot be later than to date');
      }
    }
  }

  /**
   * Определяет текущий и предыдущий периоды на основе preset и дат
   */
  private determinePeriods(options: {
    preset: string;
    from?: Date;
    to?: Date;
  }) {
    let currentFrom: Date;
    let currentTo: Date;

    if (options.preset === 'WEEK') {
      // Текущая календарная неделя (понедельник-воскресенье)
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0 = воскресенье, 1 = понедельник
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - ((dayOfWeek + 6) % 7)); // Понедельник
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6); // Воскресенье
      endOfWeek.setHours(23, 59, 59, 999);

      currentFrom = startOfWeek;
      currentTo = endOfWeek;
    } else if (options.preset === 'MONTH') {
      // Текущий календарный месяц
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      startOfMonth.setHours(0, 0, 0, 0);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Последний день месяца
      endOfMonth.setHours(23, 59, 59, 999);

      currentFrom = startOfMonth;
      currentTo = endOfMonth;
    } else if (options.preset === 'CUSTOM') {
      if (!options.from || !options.to) {
        throw new Error('From and to dates are required for CUSTOM preset');
      }
      currentFrom = new Date(options.from);
      currentTo = new Date(options.to);
    } else {
      throw new Error(`Unsupported preset: ${options.preset}`);
    }

    // Вычисляем длину периода в днях
    const periodLengthMs = currentTo.getTime() - currentFrom.getTime();
    const periodLengthDays = Math.ceil(periodLengthMs / (1000 * 60 * 60 * 24)) + 1; // +1 чтобы включить обе даты

    // Вычисляем предыдущий период такой же длины, сразу предшествующий текущему
    const previousTo = new Date(currentFrom);
    previousTo.setMilliseconds(previousTo.getMilliseconds - 1); // Момент перед началом текущего периода
    const previousFrom = new Date(previousTo);
    previousFrom.setTime(previousFrom.getTime() - periodLengthMs);

    return {
      currentPeriod: { from: currentFrom, to: currentTo },
      previousPeriod: { from: previousFrom, to: previousTo },
    };
  }

  /**
   * Получает агрегатное значение за период (одно число)
   * Для разных метрик используем разную логику агрегации
   */
  private async getPeriodAggregate(userId: string, options: {
    metric: string;
    programId?: string;
    exerciseId?: string;
    muscleGroup?: string;
    muscleMatch?: string;
    from: Date;
    to: Date;
  }): Promise<number | null> {
    // Сначала получаем дневные агрегаты за период
    const dailyAggregates = await this.getDailyAggregates(userId, {
      metric: options.metric,
      programId: options.programId,
      exerciseId: options.exerciseId,
      muscleGroup: options.muscleGroup,
      muscleMatch: options.muscleMatch,
      from: options.from,
      to: options.to,
    });

    // Агрегируем их в одно значение за весь период
    return this.aggregatePointValues(dailyAggregates, options.metric);
  }

  /**
   * Получает дневные агрегаты из БД (аналогично методу в ProgressChartService, но без cutoff date adjustment here)
   * Note: The cutoff date adjustment is done in the comparePeriods method before calling this.
   */
  private async getDailyAggregates(userId: string, options: {
    metric: string;
    programId?: string;
    exerciseId?: string;
    muscleGroup?: string;
    muscleMatch?: string;
    from: Date;
    to: Date;
  }) {
    const where: any = {
      userId,
      metric: options.metric,
      groupBy: 'DAY',
      localDate: {
        gte: options.from,
        lte: options.to,
      },
    };

    if (options.programId) {
      where.dimensionType = 'PROGRAM';
      where.dimensionId = options.programId;
    } else if (options.exerciseId) {
      where.dimensionType = 'EXERCISE';
      where.dimensionId = options.exerciseId;
    } else if (options.muscleGroup) {
      where.dimensionType = 'MUSCLE_GROUP';
      where.dimensionCode = options.muscleGroup;
    } else {
      where.dimensionType = 'GLOBAL';
      where.dimensionId = null;
      where.dimensionCode = null;
    }

    return this.prisma.progressAggregate.findMany({
      where,
      orderBy: {
        localDate: 'asc',
      },
      select: {
        localDate: true,
        value: true,
      },
    });
  }

  /**
   * Агрегирует массив значений в одно значение за период
   * (аналогично методу в ProgressChartService, но упрощённо)
   */
  private aggregatePointValues(
    points: Array<{ localDate: Date; value: number | null }>,
    metric: string
  ): number | null {
    const validPoints = points.filter(p => p.value !== null);

    if (validPoints.length === 0) {
      return null;
    }

    switch (metric) {
      case 'VOLUME':
        return validPoints.reduce((sum, p) => sum + p.value!, 0);

      case 'WORKING_WEIGHT':
        // Среднее рабочее вес за период
        const sum = validPoints.reduce((sum, p) => sum + p.value!, 0);
        return sum / validPoints.length;

      case 'ESTIMATED_1RM':
        // Максимальный 1RM за период
        return Math.max(...validPoints.map(p => p.value!));

      case 'BODY_WEIGHT':
      case 'NECK':
      case 'CHEST':
      case 'WAIST':
      case 'ABDOMEN':
      case 'HIPS':
      case 'BICEPS_LEFT':
      case 'BICEPS_RIGHT':
      case 'THIGH_LEFT':
      case 'THIGH_RIGHT':
      case 'CALF_LEFT':
      case 'CALF_RIGHT':
        // Последнее значение в периоде
        const sortedPoints = [...validPoints].sort((a, b) => a.localDate.getTime() - b.localDate.getTime());
        return sortedPoints[sortedPoints.length - 1].value!;

      default:
        return validPoints.reduce((sum, p) => sum + p.value!, 0) / validPoints.length;
    }
  }

  /**
   * Вычисляет изменение между текущим и предыдущим значением
   */
  private calculateComparison(currentValue: number | null, previousValue: number | null) {
    let absoluteChange: number | null = null;
    let percentChange: number | null = null;
    let trend: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';

    if (currentValue !== null && previousValue !== null) {
      absoluteChange = currentValue - previousValue;

      if (previousValue !== 0) {
        percentChange = ((absoluteChange / previousValue) * 100);
      } else {
        // Если предыдущее значение равно 0, процентное изменение не определено
        percentChange = null;
      }

      if (absoluteChange > 0) {
        trend = 'UP';
      } else if (absoluteChange < 0) {
        trend = 'DOWN';
      } else {
        trend = 'NEUTRAL';
      }
    } else if (currentValue !== null && previousValue === null) {
      // Есть только текущее значение, нет предыдущего
      absoluteChange = null; // Если данных в одном из периодов нет, абсолютное изменение не допускается
      percentChange = null;
      trend = 'NEUTRAL';
    } else if (currentValue === null && previousValue !== null) {
      // Есть только предыдущее значение
      absoluteChange = null;
      percentChange = null;
      trend = 'NEUTRAL';
    } else {
      // Оба значения null
      absoluteChange = null;
      percentChange = null;
      trend = 'NEUTRAL';
    }

    return {
      absoluteChange,
      percentChange,
      trend,
    };
  }

  /**
   * Возвращает единицу измерения для метрики
   */
  private getUnitForMetric(metric: string): string {
    switch (metric) {
      case 'VOLUME':
      case 'WORKING_WEIGHT':
      case 'ESTIMATED_1RM':
      case 'BODY_WEIGHT':
        return 'KG';
      default:
        return 'CM'; // Все окружности
    }
  }
}