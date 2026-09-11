import { DashboardAggregationService } from './dashboard-aggregation.service';
import { DashboardPriorityService } from './dashboard-priority.service';
import { DashboardTimezoneService } from './timezone.service';

describe('Dashboard source-of-truth calculations', () => {
  const service = new DashboardAggregationService({} as any, new DashboardPriorityService(), new DashboardTimezoneService()) as any;

  it('calculates strength volume without counting cardio', () => {
    expect(service.volume([
      { kind: 'STRENGTH', sets: [{ status: 'COMPLETED', reps: 10, weightKg: 20 }, { status: 'PLANNED', reps: 10, weightKg: 20 }] },
      { kind: 'CARDIO', sets: [{ status: 'COMPLETED', reps: 30, weightKg: 100 }] },
    ])).toBe(200);
  });

  it('calculates exercise and set progress', () => {
    expect(service.workoutProgress({ exercises: [
      { completedAt: new Date(), sets: [{ status: 'COMPLETED' }, { status: 'PLANNED' }] },
      { completedAt: null, sets: [{ status: 'PLANNED' }] },
    ] })).toEqual({ completedExercises: 1, totalExercises: 2, completedSets: 1, totalSets: 3, percent: 33 });
  });

  it('uses recorded duration before deriving it from timestamps', () => {
    expect(service.durationMinutes({ sessions: [{ durationSeconds: 3300 }], startedAt: new Date(0), completedAt: new Date(999999) })).toBe(55);
    expect(service.durationMinutes({ sessions: [], startedAt: new Date('2026-09-09T10:00:00Z'), completedAt: new Date('2026-09-09T10:54:00Z') })).toBe(54);
  });

  it('calculates weekly streak and best streak from local completion dates', () => {
    const dates = [new Date('2026-09-07T10:00:00Z'), new Date('2026-09-14T10:00:00Z'), new Date('2026-09-21T10:00:00Z')];
    expect(service.streak(dates, 'UTC', new Date('2026-09-21T00:00:00Z'))).toEqual({ currentWeeks: 3, bestWeeks: 3 });
  });
});
