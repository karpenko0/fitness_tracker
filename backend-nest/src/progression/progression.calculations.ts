export const FORMULA_VERSION = 'EPLEY_V1';
export const ALGORITHM_VERSION = 'PROGRESSION_V1';

export type CalculationSet = {
  id: string;
  status: 'COMPLETED' | 'PLANNED' | 'SKIPPED';
  setType: string;
  actualWeightKg: number | null;
  plannedWeightKg?: number | null;
  actualReps: number | null;
  plannedReps: number | null;
  rpe: number | null;
  rir: number | null;
  skipReason: string | null;
};

export function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function calculateSetVolumeKg(set: CalculationSet, effectiveWeightKg?: number | null): number | null {
  if (set.status !== 'COMPLETED' || !set.actualReps || set.actualReps <= 0) return null;
  const weight = effectiveWeightKg === undefined ? set.actualWeightKg : effectiveWeightKg;
  return weight == null ? null : round(weight * set.actualReps);
}

export function calculateEpleyOneRmKg(weightKg: number | null, reps: number | null): number | null {
  if (weightKg == null || weightKg <= 0 || reps == null || reps < 1 || reps > 12) return null;
  return round(weightKg * (1 + reps / 30), 1);
}

export function floorToIncrement(value: number, increment: number) {
  return Math.max(0, round(Math.floor((value + Number.EPSILON) / increment) * increment));
}

export function ceilToIncrement(value: number, increment: number) {
  return round(Math.ceil((value - Number.EPSILON) / increment) * increment);
}

export type RecommendationDecision = {
  weightKg: number | null;
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
  reasonCode: 'PROGRESSIVE_OVERLOAD' | 'MAINTAIN_LOAD' | 'REDUCE_LOAD' | 'PAIN_OR_DISCOMFORT' | 'INSUFFICIENT_DATA';
};

export const EQUIPMENT_STEPS: Record<string, number[]> = {
  DUMBBELL: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50],
  DUMBBELLS: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50],
  KETTLEBELL: [4, 6, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48],
  MACHINE: [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
};

export function nextAvailableWeight(currentKg: number, equipment: string | null, incrementKg: number, direction: 'up' | 'down') {
  const steps = EQUIPMENT_STEPS[(equipment || '').toUpperCase()];
  if (steps?.length) {
    if (direction === 'up') return steps.find(step => step > currentKg) ?? currentKg;
    const lower = [...steps].reverse().find(step => step < currentKg);
    return lower ?? 0;
  }
  return direction === 'up' ? ceilToIncrement(currentKg + incrementKg, incrementKg) : floorToIncrement(currentKg, incrementKg);
}

export type LoadPolicy = {
  increasePercent?: number;
  decreasePercent?: number;
  maxIncreasePercent?: number;
};

export function recommendLoad(sets: CalculationSet[], previousWeightKg: number | null, incrementKg: number, policy: LoadPolicy = {}, equipment: string | null = null): RecommendationDecision {
  if (previousWeightKg == null || !sets.length) return { weightKg: null, reasonCode: 'INSUFFICIENT_DATA' };
  const working = sets.filter(set => set.setType === 'WORKING');
  if (!working.length) return { weightKg: previousWeightKg, reasonCode: 'MAINTAIN_LOAD' };
  if (working.some(set => set.skipReason === 'PAIN_OR_DISCOMFORT')) return { weightKg: previousWeightKg, reasonCode: 'PAIN_OR_DISCOMFORT' };
  const planned = working.reduce((sum, set) => sum + (set.plannedReps || 0), 0);
  const actual = working.reduce((sum, set) => sum + (set.actualReps || 0), 0);
  const maxRpe = Math.max(...working.map(set => set.rpe ?? 0));
  const hasRirZero = working.some(set => set.rir === 0);
  const skippedTooHeavy = working.some(set => set.status === 'SKIPPED' && set.skipReason === 'TOO_HEAVY');
  const decreaseRatio = 1 - (policy.decreasePercent ?? 10) / 100;
  const increaseRatio = 1 + (policy.increasePercent ?? 5) / 100;
  const maxIncreaseRatio = 1 + (policy.maxIncreasePercent ?? 10) / 100;
  const plannedReps = working.map(set => set.plannedReps).filter((value): value is number => value != null);
  const targetRepsMin = plannedReps.length ? Math.min(...plannedReps) : null;
  const targetRepsMax = plannedReps.length ? Math.max(...plannedReps) : null;
  const isBodyweight = (equipment || '').toUpperCase() === 'BODYWEIGHT' || (equipment || '').toUpperCase() === 'BODY_WEIGHT';
  if ((planned > 0 && actual < planned * 0.8) || maxRpe === 10 || skippedTooHeavy) {
    return { weightKg: nextAvailableWeight(previousWeightKg * decreaseRatio, equipment, incrementKg, 'down'), targetRepsMin, targetRepsMax, reasonCode: 'REDUCE_LOAD' };
  }
  if (working.some(set => set.status !== 'COMPLETED') || maxRpe > 9 || hasRirZero) return { weightKg: previousWeightKg, targetRepsMin, targetRepsMax, reasonCode: 'MAINTAIN_LOAD' };
  const upperRepReached = working.every(set => set.plannedReps == null || (set.actualReps || 0) >= set.plannedReps);
  if (upperRepReached && maxRpe <= 7.5) {
    if (isBodyweight) return { weightKg: previousWeightKg, targetRepsMin, targetRepsMax: (targetRepsMax || 0) + 1, reasonCode: 'PROGRESSIVE_OVERLOAD' };
    const next = nextAvailableWeight(previousWeightKg, equipment, incrementKg, 'up');
    const capped = Math.min(next, previousWeightKg * increaseRatio, previousWeightKg * maxIncreaseRatio);
    const rounded = stepsAvailable(equipment) ? Math.min(next, previousWeightKg * maxIncreaseRatio) : ceilToIncrement(capped, incrementKg);
    return { weightKg: rounded, targetRepsMin, targetRepsMax, reasonCode: 'PROGRESSIVE_OVERLOAD' };
  }
  return { weightKg: previousWeightKg, targetRepsMin, targetRepsMax, reasonCode: 'MAINTAIN_LOAD' };
}

function stepsAvailable(equipment: string | null) {
  return Boolean(EQUIPMENT_STEPS[(equipment || '').toUpperCase()]);
}
