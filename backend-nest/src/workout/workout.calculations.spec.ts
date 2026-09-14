import { calculateVolumeKg, recommendWeight, rpeToEstimatedRir } from './workout.calculations';

describe('workout calculations', () => {
  it('counts only completed sets in training volume', () => {
    expect(calculateVolumeKg([{ status: 'COMPLETED', actualWeightKg: 60, actualReps: 10 }, { status: 'SKIPPED', actualWeightKg: 100, actualReps: 10 }, { status: 'PLANNED', actualWeightKg: 50, actualReps: 10 }])).toBe(600);
  });

  it('increases a completed low-RPE barbell performance by at most five percent', () => {
    expect(recommendWeight(100, [{ status: 'COMPLETED', rpe: 7 }, { status: 'COMPLETED', rpe: 7.5 }], 'BARBELL_OR_MACHINE')).toBe(105);
  });

  it('does not increase skipped or high-RPE performances', () => {
    expect(recommendWeight(60, [{ status: 'SKIPPED', rpe: 6 }], 'DUMBBELL')).toBe(60);
    expect(recommendWeight(60, [{ status: 'COMPLETED', rpe: 9.5 }], 'DUMBBELL')).toBe(60);
  });

  it('maps RPE to a bounded approximate RIR', () => {
    expect(rpeToEstimatedRir(8)).toBe(2);
    expect(rpeToEstimatedRir(10)).toBe(0);
  });

  it('rounds dumbbell recommendations to the available step', () => {
    expect(recommendWeight(20, [{ status: 'COMPLETED', rpe: 7 }], 'DUMBBELL', 2)).toBe(22);
  });
});
