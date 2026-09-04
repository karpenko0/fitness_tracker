import { useEffect, useMemo, useState } from 'react'
import api from '../services/api'

const steps = ['GOAL', 'TRAINING_CONTEXT', 'EXPERIENCE', 'BODY_DATA', 'EQUIPMENT', 'LIMITATIONS', 'REMINDERS', 'NUTRITION', 'REVIEW']
const labels: Record<string, string> = { WEIGHT_LOSS: 'Похудение', MUSCLE_GAIN: 'Набор мышц', MAINTENANCE: 'Поддержание формы', STRENGTH: 'Сила', ENDURANCE: 'Выносливость', HEALTH: 'Здоровье', MOBILITY_RECOVERY: 'Восстановление', GYM: 'Зал', HOME: 'Дом', OUTDOOR: 'Улица', MIXED: 'Смешанный', BEGINNER: 'Начинающий', INTERMEDIATE: 'Средний', ADVANCED: 'Продвинутый', MALE: 'Мужской', FEMALE: 'Женский', NOT_SPECIFIED: 'Не указывать' }
const fields: Record<string, { key: string; label: string; values?: string[]; type?: string }[]> = {
  GOAL: [{ key: 'fitnessGoal', label: 'Цель', values: ['WEIGHT_LOSS', 'MUSCLE_GAIN', 'MAINTENANCE', 'STRENGTH', 'ENDURANCE', 'HEALTH', 'MOBILITY_RECOVERY'] }],
  TRAINING_CONTEXT: [{ key: 'trainingLocation', label: 'Место', values: ['GYM', 'HOME', 'OUTDOOR', 'MIXED'] }, { key: 'trainingFrequency', label: 'Тренировок в неделю', values: ['2', '3', '4', '5', '6', '7'] }, { key: 'preferredWorkoutDuration', label: 'Длительность', values: ['15', '30', '45', '60', '90'] }],
  EXPERIENCE: [{ key: 'experienceLevel', label: 'Уровень', values: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] }],
  BODY_DATA: [{ key: 'gender', label: 'Пол', values: ['MALE', 'FEMALE', 'NOT_SPECIFIED'] }, { key: 'heightCm', label: 'Рост, см', type: 'number' }, { key: 'weightKg', label: 'Вес, кг', type: 'number' }],
  EQUIPMENT: [{ key: 'equipment', label: 'Оборудование через запятую', type: 'text' }],
  LIMITATIONS: [{ key: 'limitations', label: 'Ограничения и предпочтения', type: 'text' }],
  REMINDERS: [{ key: 'notificationDays', label: 'Дни (1-7), через запятую', type: 'text' }, { key: 'notificationTime', label: 'Время', type: 'time' }, { key: 'timezone', label: 'Часовой пояс', type: 'text' }],
  NUTRITION: [{ key: 'nutritionPlanNeeded', label: 'Нужен план питания?', values: ['true', 'false'] }],
  REVIEW: [],
}

export default function Onboarding() {
  const [step, setStep] = useState(0)
  const [version, setVersion] = useState(1)
  const [options, setOptions] = useState<any>(null)
  const [data, setData] = useState<Record<string, any>>(() => JSON.parse(localStorage.getItem('onboarding_draft') || '{}'))
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const current = steps[step]
  const isReview = current === 'REVIEW'
  const inputs = useMemo(() => fields[current], [current])

  useEffect(() => { Promise.all([api.get('/onboarding/status'), api.get('/onboarding/options?locale=ru')]).then(([statusResponse, optionsResponse]) => { const value = statusResponse.data.data; setVersion(value.draft.version); setData(value.draft.data || {}); setStep(Math.max(0, steps.indexOf(value.currentStep))); setOptions(optionsResponse.data.data) }).catch(() => setError('Не удалось загрузить онбординг')) }, [])
  useEffect(() => {
    const retryPending = async () => {
      const pending = localStorage.getItem('onboarding_pending')
      if (!pending) return
      try {
        const response = await api.patch('/onboarding/draft', JSON.parse(pending))
        localStorage.removeItem('onboarding_pending')
        setVersion(response.data.data.draft.version)
        setData(response.data.data.draft.data)
        setError('')
      } catch { /* Keep the latest local draft until a future online event. */ }
    }
    window.addEventListener('online', retryPending)
    void retryPending()
    return () => window.removeEventListener('online', retryPending)
  }, [])

  const valueFor = (key: string) => Array.isArray(data[key]) ? data[key].join(', ') : (data[key] ?? '')
  const update = (key: string, value: string) => setData(old => ({ ...old, [key]: key === 'trainingFrequency' || key === 'preferredWorkoutDuration' || key === 'heightCm' || key === 'weightKg' ? Number(value) : key === 'nutritionPlanNeeded' ? value === 'true' : key === 'equipment' || key === 'notificationDays' ? value.split(',').map(item => key === 'notificationDays' ? Number(item.trim()) : item.trim()).filter(Boolean) : value }))
  async function saveAndNext() {
    setError(''); localStorage.setItem('onboarding_draft', JSON.stringify(data))
    if (isReview) { try { const key = localStorage.getItem('onboarding_completion_key') || crypto.randomUUID(); localStorage.setItem('onboarding_completion_key', key); const response = await api.post('/onboarding/complete', { draftVersion: version }, { headers: { 'Idempotency-Key': key } }); localStorage.removeItem('onboarding_completion_key'); setResult(response.data.data) } catch { setError('Не удалось завершить онбординг') }; return }
    try { const response = await api.patch('/onboarding/draft', { version, currentStep: current, data }); const draft = response.data.data.draft; setVersion(draft.version); setStep(Math.min(step + 1, steps.length - 1)); setData(draft.data) } catch { localStorage.setItem('onboarding_pending', JSON.stringify({ version, currentStep: current, data })); setError('Изменения сохранены локально и будут отправлены позже') }
  }
  if (result) return <section><h1>{result.starterProgram.title}</h1><p>{result.firstWorkout.title}</p><button onClick={() => window.location.href = result.nextAction.deepLink}>Начать тренировку</button></section>
  return <section><p>Шаг {step + 1} из {steps.length}</p><h1>{isReview ? 'Проверьте данные' : current}</h1>{isReview ? <pre>{JSON.stringify(data, (key, value) => typeof value === 'string' ? labels[value] || value : value, 2)}</pre> : inputs.map(input => <label key={input.key}>{input.label}{input.values ? <select value={valueFor(input.key)} onChange={event => update(input.key, event.target.value)}><option value="">Выберите</option>{input.values.map(value => <option key={value} value={value}>{labels[value] || value}</option>)}</select> : <input type={input.type || 'text'} value={valueFor(input.key)} onChange={event => update(input.key, event.target.value)} />}</label>)}{error && <p role="alert">{error}</p>}<div><button disabled={!step} onClick={() => setStep(step - 1)}>Назад</button><button onClick={saveAndNext}>{isReview ? 'Подобрать программу' : 'Далее'}</button></div></section>
}
