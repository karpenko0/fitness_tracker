import { useParams } from 'react-router-dom'

export default function WorkoutStart() {
  const { workoutId } = useParams()
  return <section><h1>Первая тренировка</h1><p>Тренировка: {workoutId}</p></section>
}
