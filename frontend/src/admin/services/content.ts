import adminApi, { adminDelete, adminPatch, adminPost, buildParams, Paged } from '../api'

export type Exercise = {
  id: string
  title: string
  slug: string
  description: string | null
  type: string
  difficulty: number
  muscle_groups: string[] | null
  equipment: string[] | null
  unit: string | null
  contraindications: string | null
  localizations: Record<string, Record<string, unknown>> | null
  media_ids: string[]
  status: string
  published_version: number | null
  version: number
  created_at: string | null
  alternatives?: { id: string; alternative_exercise_id: string; note: string | null }[]
}

export type ProgramVersion = {
  version: number
  status: string
  created_at: string | null
  published_at: string | null
}

export type Program = {
  id: string
  title: string
  slug: string
  description: string | null
  goal: string | null
  level: string | null
  equipment: string[] | null
  duration_minutes: number | null
  weeks: unknown[]
  status: string
  published_version: number | null
  version: number
  created_at: string | null
}

export const listExercises = async (params: {
  q?: string
  type?: string
  status_filter?: string
  page?: number
  pageSize?: number
  sort?: string
}): Promise<Paged<Exercise>> => {
  const resp = await adminApi.get('/exercises', { params: buildParams(params) })
  return resp.data.data
}

export const getExercise = async (id: string): Promise<Exercise> => {
  const resp = await adminApi.get(`/exercises/${id}`)
  return resp.data.data
}

export const createExercise = async (payload: Record<string, unknown>) => {
  const resp = await adminPost('/exercises', payload)
  return resp.data.data
}

export const updateExercise = async (id: string, payload: Record<string, unknown>) => {
  const resp = await adminPatch(`/exercises/${id}`, payload)
  return resp.data.data
}

export const publishExercise = async (id: string, version: number, reason?: string) => {
  const resp = await adminPost(`/exercises/${id}/publish`, { version, reason: reason || null, confirm: true })
  return resp.data.data
}

export const unpublishExercise = async (id: string, reason?: string) => {
  const resp = await adminPost(`/exercises/${id}/unpublish`, { reason: reason || null, confirm: true })
  return resp.data.data
}

export const deleteExercise = async (id: string, reason: string) => {
  const resp = await adminDelete(`/exercises/${id}`, { reason, confirm: true })
  return resp.data.data
}

export const addAlternative = async (exerciseId: string, alternativeExerciseId: string, note?: string) => {
  const resp = await adminPost(`/exercises/${exerciseId}/alternatives`, {
    alternative_exercise_id: alternativeExerciseId,
    note: note || null,
  })
  return resp.data.data
}

export const removeAlternative = async (exerciseId: string, alternativeId: string) => {
  const resp = await adminDelete(`/exercises/${exerciseId}/alternatives/${alternativeId}`, { confirm: true })
  return resp.data.data
}

// ---------- media ----------

export type MediaItem = {
  id: string
  filename: string
  kind: 'IMAGE' | 'VIDEO'
  mime_type: string
  size_bytes: number
  checksum_sha256: string
  status: string
  public_url: string
  alt_text?: string | null
  created_at: string | null
}

export const MEDIA_LIMITS = { IMAGE: 10 * 1024 * 1024, VIDEO: 50 * 1024 * 1024 }

export const listMedia = async (params?: { kind?: string; page?: number; pageSize?: number }): Promise<Paged<MediaItem>> => {
  const resp = await adminApi.get('/media', { params: buildParams(params || {}) })
  return resp.data.data
}

export const uploadMedia = async (file: File, altText: string): Promise<MediaItem> => {
  if (file.size > 50 * 1024 * 1024) throw new Error('Файл больше 50 МБ')
  const b64 = await fileToBase64(file)
  const kind = file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE'
  if (kind === 'IMAGE' && file.size > MEDIA_LIMITS.IMAGE) throw new Error('Изображение больше 10 МБ')
  const resp = await adminPost('/media', {
    filename: file.name,
    kind,
    mime_type: file.type,
    content_base64: b64,
    alt_text: altText,
  })
  return resp.data.data
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result || '')
      resolve(s.slice(s.indexOf(',') + 1))
    }
    r.onerror = () => reject(new Error('Не удалось прочитать файл'))
    r.readAsDataURL(file)
  })
}

export const deleteMedia = async (id: string) => {
  const resp = await adminDelete(`/media/${id}`, { confirm: true })
  return resp.data.data
}

// ---------- programs ----------

export const listPrograms = async (params: {
  q?: string
  status_filter?: string
  page?: number
  pageSize?: number
  sort?: string
}): Promise<Paged<Program>> => {
  const resp = await adminApi.get('/programs', { params: buildParams(params) })
  return resp.data.data
}

export const getProgram = async (id: string): Promise<Program> => {
  const resp = await adminApi.get(`/programs/${id}`)
  return resp.data.data
}

export const createProgram = async (payload: Record<string, unknown>) => {
  const resp = await adminPost('/programs', payload)
  return resp.data.data
}

export const updateProgram = async (id: string, payload: Record<string, unknown>) => {
  const resp = await adminPatch(`/programs/${id}`, payload)
  return resp.data.data
}

export const programSubmitReview = async (id: string) => {
  const resp = await adminPost(`/programs/${id}/submit-review`, { confirm: true })
  return resp.data.data
}

export const programApprove = async (id: string) => {
  // StatusTransitionRequest is strict: only `confirm`
  const resp = await adminPost(`/programs/${id}/approve`, { confirm: true })
  return resp.data.data
}

export const programReject = async (id: string) => {
  const resp = await adminPost(`/programs/${id}/reject`, { confirm: true })
  return resp.data.data
}

export const programPublish = async (id: string, version: number, reason?: string) => {
  const resp = await adminPost(`/programs/${id}/publish`, { version, reason: reason || null, confirm: true })
  return resp.data.data
}

export const programUnpublish = async (id: string, reason?: string) => {
  const resp = await adminPost(`/programs/${id}/unpublish`, { reason: reason || null, confirm: true })
  return resp.data.data
}

export const programVersions = async (id: string): Promise<ProgramVersion[]> => {
  const resp = await adminApi.get(`/programs/${id}/versions`)
  return resp.data.data
}

export const programRollback = async (id: string, version: number) => {
  const resp = await adminPost(`/programs/${id}/rollback`, { version, confirm: true })
  return resp.data.data
}
