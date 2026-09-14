export type PerformanceSet = {
  status: 'COMPLETED' | 'PLANNED' | 'SKIPPED'
  actualWeightKg?: number | null
  actualReps?: number | null
  rpe?: number | null
}

export function calculateVolumeKg(sets: PerformanceSet[]) {
  return sets.filter(set => set.status === 'COMPLETED').reduce((total, set) => total + (set.actualWeightKg || 0) * (set.actualReps || 0), 0)
}

export function recommendWeight(previousWeightKg: number | null, sets: PerformanceSet[], equipment: 'BARBELL_OR_MACHINE' | 'DUMBBELL' | 'OTHER', dumbbellStepKg = 1) {
  if (previousWeightKg === null || sets.length === 0 || sets.some(set => set.status !== 'COMPLETED')) return previousWeightKg
  const maxRpe = Math.max(...sets.map(set => set.rpe ?? 10))
  if (maxRpe > 7.5) return previousWeightKg
  const increased = Math.min(previousWeightKg * 1.05, previousWeightKg * 1.1)
  return equipment === 'DUMBBELL' ? Math.ceil(increased / dumbbellStepKg) * dumbbellStepKg : increased
}

export function rpeToEstimatedRir(rpe: number) {
  return Math.max(0, Math.min(10, Math.round(10 - rpe)))
}
