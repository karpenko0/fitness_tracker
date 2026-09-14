import api from './api'

export type WorkoutSet = {
  id: string
  position: number
  status: 'PLANNED' | 'COMPLETED' | 'SKIPPED'
  plannedReps?: number | null
  plannedWeightKg?: number | null
  actualReps?: number | null
  actualWeightKg?: number | null
  rpe?: number | null
  rir?: number | null
  restSeconds: number
  note?: string | null
}

export type Workout = {
  id: string
  title: string
  status: 'DRAFT' | 'PLANNED' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED'
  version: number
  exercises: Array<{ id: string; title: string; position: number; muscleGroup?: string | null; equipment?: string | null; techniqueUrl?: string | null; recommendedWeightKg?: number | null; lastPerformance?: { weightKg?: number; reps?: number; sets?: number; rpe?: number } | null; sets: WorkoutSet[] }>
  activeRestTimer?: { status: string; endsAt?: string | null; pausedRemainingSeconds?: number | null } | null
}

export type CatalogExercise = { id: string; title: string; muscleGroup: string; equipment?: string | null; techniqueUrl?: string | null }
export async function getExercises() { const response = await api.get('/exercises'); return response.data.data as CatalogExercise[] }

const idempotencyKey = () => crypto.randomUUID()

export async function getWorkout(id: string) {
  const response = await api.get(`/workouts/${id}`)
  return response.data.data as Workout
}

export async function createManualWorkout(title: string) {
  const response = await api.post('/workouts', { source: { type: 'MANUAL' }, title }, { headers: { 'Idempotency-Key': idempotencyKey() } })
  return response.data.data
}

export async function startWorkout(id: string) {
  const response = await api.post(`/workouts/${id}/start`, undefined, { headers: { 'Idempotency-Key': idempotencyKey() } })
  return response.data.data as Workout
}

export async function saveSet(workoutId: string, exerciseId: string, setId: string, payload: Record<string, unknown>) {
  const response = await api.patch(`/workouts/${workoutId}/exercises/${exerciseId}/sets/${setId}`, payload, { headers: { 'Idempotency-Key': idempotencyKey() } })
  return response.data.data as Workout
}

export async function skipSet(workoutId: string, exerciseId: string, setId: string, payload: Record<string, unknown>) { const response = await api.post(`/workouts/${workoutId}/exercises/${exerciseId}/sets/${setId}/skip`, payload, { headers: { 'Idempotency-Key': idempotencyKey() } }); return response.data.data as Workout }
export async function restoreSet(workoutId: string, exerciseId: string, setId: string, payload: Record<string, unknown>) { const response = await api.post(`/workouts/${workoutId}/exercises/${exerciseId}/sets/${setId}/restore`, payload, { headers: { 'Idempotency-Key': idempotencyKey() } }); return response.data.data as Workout }
export async function deleteSet(workoutId: string, exerciseId: string, setId: string, payload: Record<string, unknown>) { const response = await api.delete(`/workouts/${workoutId}/exercises/${exerciseId}/sets/${setId}`, { data: payload, headers: { 'Idempotency-Key': idempotencyKey() } }); return response.data.data as Workout }
export async function addSet(workoutId: string, exerciseId: string, payload: Record<string, unknown>) { const response = await api.post(`/workouts/${workoutId}/exercises/${exerciseId}/sets`, payload, { headers: { 'Idempotency-Key': idempotencyKey() } }); return response.data.data as Workout }
export async function deleteExercise(workoutId: string, exerciseId: string, payload: Record<string, unknown>) { const response = await api.delete(`/workouts/${workoutId}/exercises/${exerciseId}`, { data: payload, headers: { 'Idempotency-Key': idempotencyKey() } }); return response.data.data as Workout }
export async function addExercise(workoutId: string, payload: Record<string, unknown>) { const response = await api.post(`/workouts/${workoutId}/exercises`, payload, { headers: { 'Idempotency-Key': idempotencyKey() } }); return response.data.data as Workout }
export async function replaceExercise(workoutId: string, exerciseId: string, payload: Record<string, unknown>) { const response = await api.post(`/workouts/${workoutId}/exercises/${exerciseId}/replace`, payload, { headers: { 'Idempotency-Key': idempotencyKey() } }); return response.data.data as Workout }

export async function controlRestTimer(workoutId: string, action: 'start' | 'pause' | 'resume' | 'skip', payload: Record<string, unknown>) {
  const response = await api.post(`/workouts/${workoutId}/rest-timer/${action}`, payload, { headers: { 'Idempotency-Key': idempotencyKey() } })
  return response.data.data as Workout
}

export async function completeWorkout(id: string, version: number, completeWithIncompleteSets: boolean) {
  const response = await api.post(`/workouts/${id}/complete`, { workoutVersion: version, completeWithIncompleteSets }, { headers: { 'Idempotency-Key': idempotencyKey() } })
  return response.data.data
}
