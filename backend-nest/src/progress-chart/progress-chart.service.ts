import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class ProgressChartService {
  private readonly logger = new Logger(ProgressChartService.name);

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
   * Получает данные для графика прогресса
   * Возвращает уже агрегированные точки согласно групппировке
   */
  async getChartData(userId: string, options: {
    metric: string;
    programId?: string;
    exerciseId?: string;
    muscleGroup?: string;
    muscleMatch?: string; // PRIMARY_ONLY or PRIMARY_AND_SECONDARY
    groupBy: string; // DAY, WEEK, MONTH
    from: Date;
    to: Date;
  }) {
    try {
      this.logger.log(`Fetching chart data for user ${userId}, metric: ${options.metric}, groupBy: ${options.groupBy}`);

      // Валидация параметров
      this.validateChartOptions(options);

      // Get the cutoff date for the user
      const cutoffDate = await this.getCutoffDate(userId);

      // Adjust the from date to be the maximum of the requested from and the cutoff date
      const adjustedFrom = new Date(Math.max(options.from.getTime(), cutoffDate.getTime()));

      // If the adjusted from is after the to date, then there's no data to return
      if (adjustedFrom > options.to) {
        return this.formatChartResponse(options.metric, options.groupBy, options.from, options.to, []);
      }

      // Получаем базовые дневные агрегаты
      const dailyAggregates = await this.getDailyAggregates(userId, {
        metric: options.metric,
        programId: options.programId,
        exerciseId: options.exerciseId,
        muscleGroup: options.muscleGroup,
        muscleMatch: options.muscleMatch,
        groupBy: options.groupBy,
        from: adjustedFrom,
        to: options.to,
      });

      const dailyPoints = dailyAggregates.map(a => ({
        localDate: a.localDate,
        value: a.value == null ? null : Number(a.value),
      }));

      // Если групппировка по дням, возвращаем как есть
      if (options.groupBy === 'DAY') {
        return this.formatChartResponse(options.metric, options.groupBy, options.from, options.to,
          dailyPoints.map(p => ({ date: p.localDate.toISOString().split('T')[0], value: p.value })));
      }

      // Иначе агрегируем дневные данные до запрошенной групппировки
      const aggregatedData = this.aggregateDailyData(dailyPoints, options.groupBy as 'WEEK' | 'MONTH', options.metric, options.from, options.to);

      // Проверяем, что количество точек не превышает 365
      if (aggregatedData.length > 365) {
        throw new Error(`GroupBy ${options.groupBy} would produce ${aggregatedData.length} points, which exceeds the maximum of 365`);
      }

      return this.formatChartResponse(options.metric, options.groupBy, options.from, options.to, aggregatedData);
    } catch (error) {
      this.logger.error(`Error fetching chart data:`, error);
      throw error;
    }
  }

  /**
   * Валидирует параметры запроса графика
   */
  private validateChartOptions(options: {
    metric: string;
    groupBy: string;
    from: Date;
    to: Date;
  }): void {
    const validMetrics = ['VOLUME', 'WORKING_WEIGHT', 'ESTIMATED_1RM', 'BODY_WEIGHT', 'NECK', 'CHEST', 'WAIST', 'ABDOMEN', 'HIPS', 'BICEPS_LEFT', 'BICEPS_RIGHT', 'THIGH_LEFT', 'THIGH_RIGHT', 'CALF_LEFT', 'CALF_RIGHT'];
    if (!validMetrics.includes(options.metric)) {
      throw new Error(`Invalid metric: ${options.metric}`);
    }

    const validGroupBy = ['DAY', 'WEEK', 'MONTH'];
    if (!validGroupBy.includes(options.groupBy)) {
      throw new Error(`Invalid groupBy: ${options.groupBy}`);
    }

    if (options.from > options.to) {
      throw new Error('From date cannot be later than to date');
    }

    // Проверяем максимальный период в зависимости от групппировки
    const diffTime = options.to.getTime() - options.from.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let maxDays: number;
    if (options.groupBy === 'DAY') {
      maxDays = 365; // Максимум 365 точек для дневной групппировки
    } else if (options.groupBy === 'WEEK') {
      maxDays = 365 * 7; // Теоретически, но ограничим разумным значением
    } else { // MONTH
      maxDays = 365 * 30; // Аналогично
    }

    if (diffDays > maxDays) {
      throw new Error(`Period too long for groupBy ${options.groupBy}. Maximum ${maxDays} days allowed.`);
    }
  }

  /**
   * Получает дневные агрегаты из БД с учётом фильтров
   */
  private async getDailyAggregates(userId: string, options: {
    metric: string;
    programId?: string;
    exerciseId?: string;
    muscleGroup?: string;
    muscleMatch?: string;
    groupBy: string;
    from: Date;
    to: Date;
  }) {
    const where: any = {
      userId,
      metric: options.metric,
      groupBy: options.groupBy,
      localDate: {
        gte: options.from,
        lte: options.to,
      },
    };

    // Добавляем фильтры по измерениям
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
      // Глобальные агрегаты
      where.dimensionType = 'GLOBAL';
      where.dimensionId = null;
      where.dimensionCode = null;
    }

    // Для мышечной группы нужно учесть muscleMatch
    // Пока упрощённо предполагаем, что агрегаты уже рассчитаны с правильным muscleMatch
    // TODO: Добавить логику для PRIMARY_ONLY vs PRIMARY_AND_SECONDARY при необходимости

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
   * Агрегирует дневные данные до недель или месяцев
   * С учётом типа метрики (среднее, сумма, последнее значение и т.д.)
   */
  private aggregateDailyData(
    dailyData: Array<{ localDate: Date; value: number | null }>,
    groupBy: 'WEEK' | 'MONTH',
    metric: string,
    fromDate: Date,
    toDate: Date
  ): Array<{ date: string; value: number | null }> {
    if (dailyData.length === 0) {
      return [];
    }

    const result: Array<{ date: string; value: number | null }> = [];

    if (groupBy === 'WEEK') {
      // Группируем по неделям (понедельник как начало недели)
      const weekMap = new Map<string, Array<{ localDate: Date; value: number | null }>>();

      for (const point of dailyData) {
        const date = point.localDate;
        // Вычисляем начало недели (понедельник)
        const dayOfWeek = date.getDay(); // 0 = воскресенье, 1 = понедельник и т.д.
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - ((dayOfWeek + 6) % 7)); // Переходим к понедельнику
        startOfWeek.setHours(0, 0, 0, 0);

        const weekKey = startOfWeek.toISOString().split('T')[0]; // YYYY-MM-DD

        if (!weekMap.hasOwnProperty.call(weekMap, weekKey)) {
          weekMap.set(weekKey, []);
        }
        weekMap.get(weekKey)!.push(point);
      }

      // Для каждой недели вычисляем агрегатное значение
      for (const [weekStartStr, points] of weekMap.entries()) {
        const weekStart = new Date(weekStartStr);
        const aggregatedValue = this.aggregatePointValues(points, metric);
        result.push({
          date: weekStart.toISOString().split('T')[0],
          value: aggregatedValue,
        });
      }

      // Сортируем по дате
      result.sort((a, b) => a.date.localeCompare(b.date));
    } else if (groupBy === 'MONTH') {
      // Группируем по месяцам
      const monthMap = new Map<string, Array<{ localDate: Date; value: number | null }>>();

      for (const point of dailyData) {
        const date = point.localDate;
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM

        if (!monthMap.hasOwnProperty.call(monthMap, monthKey)) {
          monthMap.set(monthKey, []);
        }
        monthMap.get(monthKey)!.push(point);
      }

      // Для каждого месяца вычисляем агрегатное значение
      for (const [monthStr, points] of monthMap.entries()) {
        const [year, month] = monthStr.split('-').map(Number);
        const monthStart = new Date(year, month - 1, 1); // Первый день месяца
        const aggregatedValue = this.aggregatePointValues(points, metric);
        result.push({
          date: monthStart.toISOString().split('T')[0],
          value: aggregatedValue,
        });
      }

      // Сортируем по дате
      result.sort((a, b) => a.date.localeCompare(b.date));
    }

    return result;
  }

  /**
   * Агрегирует массив значений в зависимости от типа метрики
   */
  private aggregatePointValues(
    points: Array<{ localDate: Date; value: number | null }>,
    metric: string
  ): number | null {
    // Фильтруем из null значений
    const validPoints = points.filter(p => p.value !== null);

    if (validPoints.length === 0) {
      return null; // Нет данных для агрегации
    }

    // В зависимости от метрики применяем разную функцию агрегации
    switch (metric) {
      case 'VOLUME':
        // Суммируем объёмы
        return validPoints.reduce((sum, p) => sum + p.value!, 0);

      case 'WORKING_WEIGHT':
        // Для рабочего веса: средневзвешенный или максимальный?
        // Согласно спец: для графика рабочих весов возвращать максимальный и средний рабочий вес
        // Но в прогрессе обычно показывают тренд, поэтому, возможно, среднее
        // Пока делаем среднее значение
        const workingWeightTotal = validPoints.reduce((total, p) => total + p.value!, 0);
        return workingWeightTotal / validPoints.length;

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
        // Для измерений тела: последнее значение в периоде
        // Сортируем по дате и берём последнее
        const sortedPoints = [...validPoints].sort((a, b) => a.localDate.getTime() - b.localDate.getTime());
        return sortedPoints[sortedPoints.length - 1].value!;

      default: {
        // По умолчанию берём среднее
        const total = validPoints.reduce((acc, p) => acc + p.value!, 0);
        return total / validPoints.length;
      }
    }
  }

  /**
   * Форматирует ответ в соответствии со спецификацией API
   */
  private formatChartResponse(
    metric: string,
    groupBy: string,
    fromDate: Date,
    toDate: Date,
    points: Array<{ date: string; value: number | null }>
  ) {
    // Определяем единицу измерения
    let unit: string;
    if (metric === 'VOLUME' || metric === 'WORKING_WEIGHT' || metric === 'ESTIMATED_1RM') {
      unit = 'KG';
    } else if (metric === 'BODY_WEIGHT') {
      unit = 'KG';
    } else {
      unit = 'CM'; // Все окружности
    }

    // Преобразуем точки в формат API
    const formattedPoints = points.map(p => ({
      date: p.date,
      value: p.value,
    }));

    return {
      metric,
      unit,
      groupBy,
      period: {
        from: fromDate.toISOString().split('T')[0],
        to: toDate.toISOString().split('T')[0],
        timezone: 'UTC', // TODO: Получить реальную таймзону пользователя
      },
      // Фильтры будут добавлены позже согласно спецификации
      filters: {},
      points: formattedPoints,
    };
  }
}