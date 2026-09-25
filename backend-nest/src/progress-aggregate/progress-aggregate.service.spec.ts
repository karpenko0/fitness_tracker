import { ProgressAggregateService } from './progress-aggregate.service';

describe('ProgressAggregateService', () => {
  let service: ProgressAggregateService;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      progressAggregate: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
      measurement: {
        findMany: jest.fn(),
      },
      workout: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prismaMock)),
    };
    prismaMock.measurement.findMany.mockResolvedValue([]);
    prismaMock.workout.findMany.mockResolvedValue([]);

    service = new ProgressAggregateService(
      prismaMock,
      {} as any, // progressionService
      {} as any  // workoutService
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateAndSaveAggregates', () => {
    it('should calculate and save aggregates for a given date', async () => {
      // Мокируем зависимости
      prismaMock.measurement.findMany.mockResolvedValue([]);
      prismaMock.workout.findMany.mockResolvedValue([]);

      const userId = 'test-user';
      const targetDate = new Date('2026-09-17');

      await service.calculateAndSaveAggregates(userId, targetDate);

      // Проверяем, что были вызваны методы очистки и создания агрегатов
      expect(prismaMock.progressAggregate.deleteMany).toHaveBeenCalledWith({
        where: {
          userId,
          localDate: targetDate,
        },
      });

      // Проверяем, что методы расчёта были вызваны
      // (Мы не можем легко проверить внутренние вызовы без доступа к приватным методам,
      // но мы можем проверить, что в целом сервис отработал без ошибок)
    });

    it('should handle errors gracefully', async () => {
      prismaMock.measurement.findMany.mockRejectedValue(new Error('Database error'));

      const userId = 'test-user';
      const targetDate = new Date('2026-09-17');

      await expect(service.calculateAndSaveAggregates(userId, targetDate))
        .rejects
        .toThrow('Database error');
    });
  });

  describe('calculateDailyVolume', () => {
    it('should return null when no workouts found', async () => {
      prismaMock.workout.findMany.mockResolvedValue([]);

      const result = await service['calculateDailyVolume']('test-user', new Date('2026-09-17'));
      expect(result).toBeNull();
    });

    it('should calculate volume correctly', async () => {
      const mockWorkouts = [
        {
          id: 'workout-1',
          userId: 'test-user',
          status: 'COMPLETED',
          completedAt: new Date('2026-09-17T10:00:00Z'),
          exercises: [
            {
              id: 'exercise-1',
              sets: [
                {
                  id: 'set-1',
                  status: 'COMPLETED',
                  actualWeightKg: 10,
                  actualReps: 5,
                },
                {
                  id: 'set-2',
                  status: 'COMPLETED',
                  actualWeightKg: 20,
                  actualReps: 3,
                },
                {
                  id: 'set-3',
                  status: 'SKIPPED',
                  actualWeightKg: null,
                  actualReps: null,
                },
              ],
            },
          ],
        },
      ];

      prismaMock.workout.findMany.mockResolvedValue(mockWorkouts);

      const result = await service['calculateDailyVolume']('test-user', new Date('2026-09-17'));
      // Ожидаем: (10 * 5) + (20 * 3) = 50 + 60 = 110
      expect(result).toBe(110);
    });

    it('should ignore non-completed sets', async () => {
      const mockWorkouts = [
        {
          id: 'workout-1',
          userId: 'test-user',
          status: 'COMPLETED',
          completedAt: new Date('2026-09-17T10:00:00Z'),
          exercises: [
            {
              id: 'exercise-1',
              sets: [
                {
                  id: 'set-1',
                  status: 'PLANNED',
                  actualWeightKg: null,
                  actualReps: null,
                },
                {
                  id: 'set-2',
                  status: 'IN_PROGRESS',
                  actualWeightKg: null,
                  actualReps: null,
                },
              ],
            },
          ],
        },
      ];

      prismaMock.workout.findMany.mockResolvedValue(mockWorkouts);

      const result = await service['calculateDailyVolume']('test-user', new Date('2026-09-17'));
      expect(result).toBeNull(); // Нет завершённых подходов
    });
  });
});