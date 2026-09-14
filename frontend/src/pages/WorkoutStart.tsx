import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { addExercise, addSet, completeWorkout, controlRestTimer, deleteExercise, deleteSet, getExercises, getWorkout, replaceExercise, restoreSet, saveSet, skipSet, startWorkout, type CatalogExercise, type Workout, type WorkoutSet } from '../services/workoutService'

type PendingChange = { exerciseId: string; setId: string; payload: Record<string, unknown> }
const queueKey = (id: string) => `workout-pending:${id}`

export default function WorkoutStart() {
  const { workoutId } = useParams()
  const navigate = useNavigate()
  const [workout, setWorkout] = useState<Workout | null>(null)
  const [syncState, setSyncState] = useState('Загружаем')
  const [restRemaining, setRestRemaining] = useState<number | null>(null)
  const [summary, setSummary] = useState<any>(null)
  const [catalog, setCatalog] = useState<CatalogExercise[]>([])
  const [selectedExerciseId, setSelectedExerciseId] = useState('')
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const apply = (next: Workout) => { setWorkout(next); setSyncState('Сохранено') }
  const refresh = async () => { if (!workoutId) return; try { apply(await getWorkout(workoutId)) } catch { setSyncState('Не удалось загрузить тренировку') } }

  useEffect(() => { void refresh(); void getExercises().then(setCatalog).catch(() => undefined) }, [workoutId])
  useEffect(() => {
    const update = () => {
      const endsAt = workout?.activeRestTimer?.endsAt
      if (workout?.activeRestTimer?.status === 'PAUSED') return setRestRemaining(workout.activeRestTimer.pausedRemainingSeconds ?? 0)
      if (!endsAt || workout?.activeRestTimer?.status !== 'RUNNING') return setRestRemaining(null)
      setRestRemaining(Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000)))
    }
    update()
    const interval = window.setInterval(update, 1000)
    return () => window.clearInterval(interval)
  }, [workout?.activeRestTimer])
  useEffect(() => {
    const replay = async () => {
      if (!workout || !workoutId || !navigator.onLine) return
      const queued: PendingChange[] = JSON.parse(localStorage.getItem(queueKey(workoutId)) || '[]')
      if (!queued.length) return
      try {
        let current = workout
        for (const change of queued) current = await saveSet(workoutId, change.exerciseId, change.setId, { ...change.payload, workoutVersion: current.version })
        localStorage.removeItem(queueKey(workoutId)); apply(current)
      } catch { setSyncState('Не удалось сохранить - повторите') }
    }
    window.addEventListener('online', replay); void replay()
    return () => window.removeEventListener('online', replay)
  }, [workout, workoutId])

  const updateSet = (exerciseId: string, set: WorkoutSet, changes: Record<string, unknown>, immediate = false) => {
    if (!workout || !workoutId) return
    const payload = { ...changes }
    setSyncState(navigator.onLine ? 'Сохраняем' : 'Нет соединения - данные будут отправлены позже')
    window.clearTimeout(timers.current[set.id])
    const send = async () => {
      if (!navigator.onLine) {
        const queued: PendingChange[] = JSON.parse(localStorage.getItem(queueKey(workoutId)) || '[]')
        localStorage.setItem(queueKey(workoutId), JSON.stringify([...queued, { exerciseId, setId: set.id, payload }]))
        return
      }
      try { apply(await saveSet(workoutId, exerciseId, set.id, { ...payload, workoutVersion: workout.version })) }
      catch (error: any) { if (error?.response?.data?.error?.code === 'WORKOUT_VERSION_CONFLICT') { setSyncState('Тренировка изменена в другом сеансе'); await refresh() } else setSyncState('Не удалось сохранить - повторите') }
    }
    if (immediate) void send(); else timers.current[set.id] = window.setTimeout(() => void send(), 400)
  }

  const finish = async () => {
    if (!workout || !workoutId) return
    const incomplete = workout.exercises.some(exercise => exercise.sets.some(set => set.status === 'PLANNED'))
    if (incomplete && !window.confirm('Есть незавершенные подходы. Завершить тренировку?')) return
    try { setSummary(await completeWorkout(workoutId, workout.version, incomplete)) } catch { setSyncState('Не удалось завершить тренировку') }
  }

  if (summary) return <section><h1>Тренировка завершена</h1><p>Длительность: {summary.durationMinutes} мин.</p><p>Упражнений: {summary.summary.exerciseCount}</p><p>Выполнено подходов: {summary.summary.completedSets}</p><p>Пропущено: {summary.summary.skippedSets}</p><p>Объем: {summary.summary.totalVolumeKg} кг</p><button onClick={() => navigate('/')}>На главный экран</button></section>
  if (!workout) return <section><p>{syncState}</p></section>
  return <section>
    <h1>{workout.title}</h1>
    <p aria-live="polite">{syncState}</p>
    {workout.status === 'DRAFT' || workout.status === 'PLANNED' ? <button onClick={() => void startWorkout(workout.id).then(apply)}>Начать</button> : null}
    {restRemaining !== null ? <div><strong>Отдых: {Math.floor(restRemaining / 60)}:{String(restRemaining % 60).padStart(2, '0')}</strong>{workout.activeRestTimer?.status === 'PAUSED' ? <button onClick={() => void controlRestTimer(workout.id, 'resume', { workoutVersion: workout.version }).then(apply)}>Возобновить</button> : <button onClick={() => void controlRestTimer(workout.id, 'pause', { workoutVersion: workout.version }).then(apply)}>Пауза</button>}<button onClick={() => void controlRestTimer(workout.id, 'skip', { workoutVersion: workout.version }).then(apply)}>Пропустить отдых</button>{[15, 30, 60].map(seconds => <button key={seconds} onClick={() => void controlRestTimer(workout.id, 'extend', { workoutVersion: workout.version, seconds }).then(apply)}>+{seconds} сек</button>)}</div> : null}
    {workout.status !== 'COMPLETED' ? <div><label>Добавить упражнение <select value={selectedExerciseId} onChange={event => setSelectedExerciseId(event.target.value)}><option value="">Выберите упражнение</option>{catalog.map(exercise => <option key={exercise.id} value={exercise.id}>{exercise.title}</option>)}</select></label><button disabled={!selectedExerciseId} onClick={() => void addExercise(workout.id, { workoutVersion: workout.version, exerciseId: selectedExerciseId }).then(next => { apply(next); setSelectedExerciseId('') })}>Добавить</button></div> : null}
    {workout.exercises.map(exercise => <article key={exercise.id}><h2>{exercise.position}. {exercise.title}</h2><p>{exercise.muscleGroup} {exercise.equipment ? `· ${exercise.equipment}` : ''}</p>{exercise.techniqueUrl ? <a href={exercise.techniqueUrl} target="_blank" rel="noreferrer">Техника выполнения</a> : null}{exercise.lastPerformance ? <p>Прошлый результат: {exercise.lastPerformance.weightKg} кг × {exercise.lastPerformance.reps}, {exercise.lastPerformance.sets} подхода</p> : null}{exercise.recommendedWeightKg != null ? <p>Рекомендуемый вес: {exercise.recommendedWeightKg} кг</p> : null}<label>Заменить на <select defaultValue="" onChange={event => { if (event.target.value) void replaceExercise(workout.id, exercise.id, { workoutVersion: workout.version, replacementExerciseId: event.target.value }).then(apply) }}><option value="">Выберите альтернативу</option>{catalog.filter(item => item.muscleGroup === exercise.muscleGroup && item.id !== (exercise as any).catalogExerciseId).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>{exercise.sets.map(set => <div key={set.id}>
      <span>Подход {set.position}</span>
      <input aria-label={`Вес подхода ${set.position}`} type="number" min="0" step="0.25" defaultValue={set.actualWeightKg ?? set.plannedWeightKg ?? ''} disabled={workout.status === 'COMPLETED'} onChange={event => updateSet(exercise.id, set, { actualWeightKg: event.target.value === '' ? null : Number(event.target.value) })} />
      <input aria-label={`Повторы подхода ${set.position}`} type="number" min="0" step="1" defaultValue={set.actualReps ?? set.plannedReps ?? ''} disabled={workout.status === 'COMPLETED'} onChange={event => updateSet(exercise.id, set, { actualReps: event.target.value === '' ? null : Number(event.target.value) })} />
       <input aria-label={`RPE подхода ${set.position}`} type="number" min="1" max="10" step="0.5" defaultValue={set.rpe ?? ''} disabled={workout.status === 'COMPLETED'} onChange={event => updateSet(exercise.id, set, { rpe: event.target.value === '' ? null : Number(event.target.value) })} />
       <input aria-label={`RIR подхода ${set.position}`} type="number" min="0" max="10" step="1" defaultValue={set.rir ?? ''} disabled={workout.status === 'COMPLETED'} onChange={event => updateSet(exercise.id, set, { rir: event.target.value === '' ? null : Number(event.target.value) })} />
       <input aria-label={`Заметка подхода ${set.position}`} maxLength={500} defaultValue={set.note ?? ''} disabled={workout.status === 'COMPLETED'} onChange={event => updateSet(exercise.id, set, { note: event.target.value })} />
       {set.status === 'PLANNED' ? <><button disabled={workout.status !== 'IN_PROGRESS' || set.actualReps == null} onClick={() => updateSet(exercise.id, set, { status: 'COMPLETED' }, true)}>Готово</button><select aria-label={`Причина пропуска подхода ${set.position}`} defaultValue="USER_DECISION" onChange={event => { if (event.target.value === 'PAIN_OR_DISCOMFORT') window.alert('При боли прекратите упражнение и при необходимости обратитесь к специалисту.') }}><option value="NO_TIME">Нет времени</option><option value="TOO_HEAVY">Слишком тяжело</option><option value="PAIN_OR_DISCOMFORT">Боль или дискомфорт</option><option value="EQUIPMENT_UNAVAILABLE">Нет оборудования</option><option value="USER_DECISION">Решение пользователя</option><option value="OTHER">Другое</option></select><button onClick={event => { const reason = (event.currentTarget.previousElementSibling as HTMLSelectElement).value; void skipSet(workout.id, exercise.id, set.id, { workoutVersion: workout.version, reason }).then(apply) }}>Пропустить</button></> : set.status === 'SKIPPED' ? <button onClick={() => void restoreSet(workout.id, exercise.id, set.id, { workoutVersion: workout.version }).then(apply)}>Восстановить</button> : <span>Выполнен</span>}
       {exercise.sets.length > 1 ? <button onClick={() => void deleteSet(workout.id, exercise.id, set.id, { workoutVersion: workout.version }).then(apply)}>Удалить подход</button> : null}
    </div>)}<button onClick={() => void addSet(workout.id, exercise.id, { workoutVersion: workout.version }).then(apply)}>Добавить подход</button><button onClick={() => { if (window.confirm('Удалить упражнение?')) void deleteExercise(workout.id, exercise.id, { workoutVersion: workout.version, confirmCompletedSets: true }).then(apply) }}>Удалить упражнение</button></article>)}
    {workout.status === 'IN_PROGRESS' || workout.status === 'PAUSED' ? <button onClick={() => void finish()}>Завершить тренировку</button> : null}
  </section>
}
