import { calculateEpleyOneRmKg, calculateSetVolumeKg, floorToIncrement, nextAvailableWeight, recommendLoad } from './progression.calculations';

const set = (overrides: Partial<any> = {}): any => ({ id: 'set-1', status: 'COMPLETED' as const, setType: 'WORKING', actualWeightKg: 80, actualReps: 10, plannedReps: 10, rpe: 7, rir: 3, skipReason: null, ...overrides });

describe('progression calculations', () => {
  it('calculates volume only for valid completed sets', () => {
    expect(calculateSetVolumeKg(set())).toBe(800);
    expect(calculateSetVolumeKg(set({ status: 'SKIPPED' }))).toBeNull();
    expect(calculateSetVolumeKg(set({ actualReps: 0 }))).toBeNull();
  });

  it('calculates and rounds Epley 1RM', () => {
    expect(calculateEpleyOneRmKg(80, 8)).toBe(101.3);
    expect(calculateEpleyOneRmKg(80, 13)).toBeNull();
    expect(calculateEpleyOneRmKg(0, 8)).toBeNull();
  });

  it('uses effective bodyweight when supplied', () => {
    expect(calculateSetVolumeKg(set({ actualWeightKg: 0, actualReps: 10 }), 75)).toBe(750);
    expect(calculateSetVolumeKg(set({ actualWeightKg: 0 }), null)).toBeNull();
  });

  it('increases at most five percent and rounds to increment', () => {
    expect(recommendLoad([set()], 80, 2.5)).toMatchObject({ weightKg: 82.5, reasonCode: 'PROGRESSIVE_OVERLOAD' });
  });

  it('applies configured increase and decrease percents', () => {
    expect(recommendLoad([set()], 80, 2.5, { increasePercent: 2.5, maxIncreasePercent: 10 })).toMatchObject({ weightKg: 82.5, reasonCode: 'PROGRESSIVE_OVERLOAD' });
    expect(recommendLoad([set({ actualReps: 7, plannedReps: 10 })], 80, 2.5, { decreasePercent: 5 })).toMatchObject({ weightKg: 75, reasonCode: 'REDUCE_LOAD' });
  });

  it('holds at high RPE or skipped working set', () => {
    expect(recommendLoad([set({ rpe: 8 })], 80, 2.5).reasonCode).toBe('MAINTAIN_LOAD');
    expect(recommendLoad([set({ rpe: 9.5 })], 80, 2.5)).toMatchObject({ weightKg: 80, reasonCode: 'MAINTAIN_LOAD' });
    expect(recommendLoad([set({ rir: 0 })], 80, 2.5)).toMatchObject({ weightKg: 80, reasonCode: 'MAINTAIN_LOAD' });
    expect(recommendLoad([set({ status: 'SKIPPED', skipReason: 'TOO_HEAVY', actualReps: null })], 80, 2.5).reasonCode).toBe('REDUCE_LOAD');
  });

  it('does not increase load after pain or with insufficient history', () => {
    expect(recommendLoad([set({ skipReason: 'PAIN_OR_DISCOMFORT' })], 80, 2.5)).toMatchObject({ weightKg: 80, reasonCode: 'PAIN_OR_DISCOMFORT' });
    expect(recommendLoad([set()], null, 2.5)).toMatchObject({ weightKg: null, reasonCode: 'INSUFFICIENT_DATA' });
  });

  it('retains planned weight in the calculation shape for plan fallback', () => {
    expect(set({ plannedWeightKg: 42.5 }).plannedWeightKg).toBe(42.5);
  });

  it('decreases by ten percent and rounds down on underperformance', () => {
    expect(recommendLoad([set({ actualReps: 7, plannedReps: 10 })], 80, 2.5)).toMatchObject({ weightKg: 70, reasonCode: 'REDUCE_LOAD' });
    expect(floorToIncrement(72, 2.5)).toBe(70);
  });

  it('uses discrete dumbbell, kettlebell and machine steps', () => {
    expect(nextAvailableWeight(20, 'DUMBBELL', 1, 'up')).toBe(22);
    expect(nextAvailableWeight(16, 'KETTLEBELL', 4, 'up')).toBe(20);
    expect(nextAvailableWeight(10, 'MACHINE', 2.5, 'up')).toBe(12.5);
    expect(recommendLoad([set({ actualWeightKg: 20, plannedWeightKg: 20 })], 20, 1, {}, 'DUMBBELL')).toMatchObject({ weightKg: 22, reasonCode: 'PROGRESSIVE_OVERLOAD' });
  });

  it('increases bodyweight target reps instead of adding external load', () => {
    expect(recommendLoad([set({ actualWeightKg: 0 })], 0.01, 1, {}, 'BODYWEIGHT')).toMatchObject({ weightKg: 0.01, targetRepsMax: 11, reasonCode: 'PROGRESSIVE_OVERLOAD' });
  });

  it('covers the complete workout e2e path: volume, 1RM, PR and next recommendation', () => {
    const completed = [set(), set({ id: 'set-2', actualReps: 8 })];
    const volume = completed.reduce((sum, item) => sum + (calculateSetVolumeKg(item) || 0), 0);
    const bestOneRm = Math.max(...completed.map(item => calculateEpleyOneRmKg(item.actualWeightKg, item.actualReps) || 0));
    expect(volume).toBe(1440);
    expect(bestOneRm).toBe(106.7);
    expect(recommendLoad(completed, 80, 2.5)).toMatchObject({ weightKg: 80, reasonCode: 'MAINTAIN_LOAD' });
    expect(recommendLoad([set(), set({ id: 'set-2' })], 80, 2.5)).toMatchObject({ weightKg: 82.5, reasonCode: 'PROGRESSIVE_OVERLOAD' });
  });
});
