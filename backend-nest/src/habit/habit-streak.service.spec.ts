import { HabitLocalDateService } from './habit-local-date.service';
import { HabitStreakService, StreakHabitLike, StreakTask } from './habit-streak.service';

describe('HabitStreakService', () => {
  const localDates = new HabitLocalDateService();
  const service = new HabitStreakService({} as any, localDates);

  // Пятница, 25.09.2026, 12:00 UTC
  const now = new Date('2026-09-25T12:00:00Z');
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

  const habit = (overrides: Partial<StreakHabitLike> = {}): StreakHabitLike => ({
    schedule: 'DAILY',
    weekdays: [],
    oneTimeDate: null,
    timezone: 'UTC',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  });

  const task = (iso: string, status: StreakTask['status']): StreakTask => ({ localDate: day(iso), status });

  it('consecutive completed scheduled tasks increase currentStreak', () => {
    const tasks = [task('2026-09-23', 'COMPLETED'), task('2026-09-24', 'COMPLETED'), task('2026-09-25', 'COMPLETED')];
    expect(service.computeCurrentStreak(habit(), tasks, now)).toBe(3);
  });

  it('days outside the schedule do not break the streak', () => {
    // ПН/СР/ПТ [1,3,5]: выполнены 21.09 (ПН), 23.09 (СР), 25.09 (ПТ); вт и чт — вне расписания
    const tasks = [task('2026-09-21', 'COMPLETED'), task('2026-09-23', 'COMPLETED'), task('2026-09-25', 'COMPLETED')];
    const streak = service.computeCurrentStreak(habit({ schedule: 'WEEKDAYS', weekdays: [1, 3, 5] }), tasks, now);
    expect(streak).toBe(3);
  });

  it('SKIPPED breaks the streak', () => {
    const tasks = [task('2026-09-23', 'COMPLETED'), task('2026-09-24', 'COMPLETED'), task('2026-09-25', 'SKIPPED')];
    expect(service.computeCurrentStreak(habit(), tasks, now)).toBe(0);
  });

  it('EXPIRED breaks the streak', () => {
    const tasks = [task('2026-09-23', 'COMPLETED'), task('2026-09-24', 'EXPIRED')];
    // Сегодняшнего задания ещё нет — но вчерашний EXPIRED уже разорвал цепочку
    expect(service.computeCurrentStreak(habit(), tasks, now)).toBe(0);
  });

  it("today's pending task does not break the streak until the local day ends", () => {
    const tasks = [task('2026-09-23', 'COMPLETED'), task('2026-09-24', 'COMPLETED'), task('2026-09-25', 'PENDING')];
    expect(service.computeCurrentStreak(habit(), tasks, now)).toBe(2);
  });

  it('a past scheduled day without completion breaks the streak', () => {
    const tasks = [task('2026-09-23', 'COMPLETED'), task('2026-09-24', 'PENDING')]; // вчера не выполнено и день закончился
    expect(service.computeCurrentStreak(habit(), tasks, now)).toBe(0);
  });

  it('changing completion within the day recalculates the streak', () => {
    const before = [task('2026-09-24', 'COMPLETED'), task('2026-09-25', 'PENDING')];
    expect(service.computeCurrentStreak(habit(), before, now)).toBe(1);
    const after = [task('2026-09-24', 'COMPLETED'), task('2026-09-25', 'COMPLETED')];
    expect(service.computeCurrentStreak(habit(), after, now)).toBe(2);
  });

  it('timezone change does not create a false streak break', () => {
    // Пользователь летел на восток и обратно: задания выполнялись по московским датам
    // вплоть до 25.09, а «сегодня» в Гонолулу ещё 24.09. Обход начинается с 25.09.
    const tasks = [task('2026-09-24', 'COMPLETED'), task('2026-09-25', 'COMPLETED')];
    const streak = service.computeCurrentStreak(habit({ timezone: 'Pacific/Honolulu' }), tasks, now);
    expect(streak).toBe(2);
  });

  it('ONE_TIME habit streak is 0 or 1', () => {
    const habitOneTime = habit({ schedule: 'ONE_TIME', oneTimeDate: day('2026-09-25') });
    expect(service.computeCurrentStreak(habitOneTime, [task('2026-09-25', 'PENDING')], now)).toBe(0);
    expect(service.computeCurrentStreak(habitOneTime, [task('2026-09-25', 'COMPLETED')], now)).toBe(1);
  });

  it('does not count days before the habit was created', () => {
    const tasks = [task('2026-09-24', 'COMPLETED'), task('2026-09-25', 'COMPLETED')];
    const young = habit({ createdAt: new Date('2026-09-25T08:00:00Z') });
    expect(service.computeCurrentStreak(young, tasks, now)).toBe(1);
  });

  describe('recalcForHabit', () => {
    const prisma: any = {
      habit: { findUnique: jest.fn(), update: jest.fn() },
      habitTask: { findMany: jest.fn() },
    };
    const svc = () => new HabitStreakService(prisma, localDates);

    beforeEach(() => jest.clearAllMocks());

    it('updates current and best streak', async () => {
      prisma.habit.findUnique.mockResolvedValue({ ...habit(), id: 'h1', currentStreak: 1, bestStreak: 4 });
      prisma.habitTask.findMany.mockResolvedValue([
        task('2026-09-24', 'COMPLETED'),
        task('2026-09-25', 'COMPLETED'),
      ]);
      await svc().recalcForHabit('h1', prisma, now);
      expect(prisma.habit.update).toHaveBeenCalledWith({ where: { id: 'h1' }, data: { currentStreak: 2, bestStreak: 4 } });
    });

    it('bestStreak never decreases when the current streak is lost', async () => {
      prisma.habit.findUnique.mockResolvedValue({ ...habit(), id: 'h1', currentStreak: 5, bestStreak: 5 });
      prisma.habitTask.findMany.mockResolvedValue([task('2026-09-25', 'SKIPPED')]);
      await svc().recalcForHabit('h1', prisma, now);
      expect(prisma.habit.update).toHaveBeenCalledWith({ where: { id: 'h1' }, data: { currentStreak: 0, bestStreak: 5 } });
    });

    it('does not write when nothing changed', async () => {
      prisma.habit.findUnique.mockResolvedValue({ ...habit(), id: 'h1', currentStreak: 0, bestStreak: 0 });
      prisma.habitTask.findMany.mockResolvedValue([]);
      await svc().recalcForHabit('h1', prisma, now);
      expect(prisma.habit.update).not.toHaveBeenCalled();
    });
  });
});
