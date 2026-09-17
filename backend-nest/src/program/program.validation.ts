import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { CONTRAINDICATION_TAGS, EQUIPMENT_TYPES, MUSCLE_GROUPS } from './program.constants';

export function assertRange(value: number, min: number, max: number, field: string) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `${field} must be between ${min} and ${max}`, details: [{ field }] });
  }
}

export function assertIntegerRange(value: number, min: number, max: number, field: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `${field} must be an integer between ${min} and ${max}`, details: [{ field }] });
  }
}

export function assertRpe(value: number | null | undefined, field = 'targetRpe') {
  if (value == null) return;
  if (!Number.isFinite(value) || value < 1 || value > 10 || Math.round(value * 2) !== value * 2) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `${field} must be 1..10 in 0.5 increments`, details: [{ field }] });
  }
}

export function assertRepsRange(min: number, max: number) {
  assertIntegerRange(min, 1, 100, 'plannedRepsMin');
  assertIntegerRange(max, 1, 100, 'plannedRepsMax');
  if (max < min) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'plannedRepsMax cannot be less than plannedRepsMin', details: [{ field: 'plannedRepsMax' }] });
}

export function assertWeight(value: number | null | undefined, field = 'plannedWeightKg') {
  if (value == null) return;
  if (!Number.isFinite(value) || value < 0 || value > 1000) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `${field} must be between 0 and 1000`, details: [{ field }] });
  }
}

export function assertMuscles(values: unknown, field = 'primaryMuscles') {
  const list = Array.isArray(values) ? values.map(String) : [];
  if (field === 'primaryMuscles' && !list.length) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'At least one primary muscle is required', details: [{ field }] });
  if (list.some((item) => !MUSCLE_GROUPS.includes(item as any))) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown muscle group', details: [{ field }] });
  return list;
}

export function assertEquipment(values: unknown, field = 'equipment') {
  const list = Array.isArray(values) ? values.map(String) : typeof values === 'string' && values ? values.split(',').map((item) => item.trim()).filter(Boolean) : [];
  if (list.some((item) => !EQUIPMENT_TYPES.includes(item as any))) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown equipment value', details: [{ field }] });
  return list;
}

export function assertContraindications(values: unknown) {
  const list = Array.isArray(values) ? values.map(String) : [];
  if (list.some((item) => !CONTRAINDICATION_TAGS.includes(item as any))) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown contraindication tag', details: [{ field: 'contraindications' }] });
  return list;
}

export function validateProgramMeta(input: { title?: string; description?: string; durationWeeks?: number; workoutsPerWeek?: number; estimatedWorkoutDurationMinutes?: number }) {
  if (input.title != null && (input.title.trim().length < 3 || input.title.trim().length > 120)) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'title must be 3..120 characters', details: [{ field: 'title' }] });
  }
  if (input.description != null && input.description.length > 2000) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'description must be at most 2000 characters', details: [{ field: 'description' }] });
  }
  if (input.durationWeeks != null) assertIntegerRange(input.durationWeeks, 1, 52, 'durationWeeks');
  if (input.workoutsPerWeek != null) assertIntegerRange(input.workoutsPerWeek, 1, 7, 'workoutsPerWeek');
  if (input.estimatedWorkoutDurationMinutes != null) assertIntegerRange(input.estimatedWorkoutDurationMinutes, 10, 180, 'estimatedWorkoutDurationMinutes');
}

export function validateDayMeta(input: { title?: string; description?: string; scheduledWeekday?: number | null; estimatedDurationMinutes?: number }) {
  if (input.title != null && (input.title.trim().length < 1 || input.title.trim().length > 120)) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'title must be 1..120 characters', details: [{ field: 'title' }] });
  }
  if (input.description != null && input.description.length > 1000) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'description must be at most 1000 characters', details: [{ field: 'description' }] });
  }
  if (input.scheduledWeekday != null) assertIntegerRange(input.scheduledWeekday, 1, 7, 'scheduledWeekday');
  if (input.estimatedDurationMinutes != null) assertIntegerRange(input.estimatedDurationMinutes, 10, 180, 'estimatedDurationMinutes');
}

export function validateExercisePlan(input: { plannedSets?: number; plannedRepsMin?: number; plannedRepsMax?: number; plannedWeightKg?: number | null; targetRpe?: number | null; restSeconds?: number; note?: string | null }) {
  if (input.plannedSets != null) assertIntegerRange(input.plannedSets, 1, 20, 'plannedSets');
  if (input.plannedRepsMin != null || input.plannedRepsMax != null) {
    assertRepsRange(input.plannedRepsMin ?? 1, input.plannedRepsMax ?? input.plannedRepsMin ?? 1);
  }
  assertWeight(input.plannedWeightKg);
  assertRpe(input.targetRpe);
  if (input.restSeconds != null) assertIntegerRange(input.restSeconds, 0, 3600, 'restSeconds');
  if (input.note != null && input.note.length > 500) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'note must be at most 500 characters', details: [{ field: 'note' }] });
}

export function validateActivatableStructure(program: { workouts: Array<{ isRestDay: boolean; exercises: Array<{ sets: unknown[]; plannedSets?: unknown }> }> }) {
  if (!program.workouts.length) throw new UnprocessableEntityException({ code: 'PROGRAM_STRUCTURE_INVALID', message: 'Program must contain at least one training day' });
  const trainable = program.workouts.filter((day) => !day.isRestDay);
  if (!trainable.some((day) => day.exercises.length > 0)) {
    throw new UnprocessableEntityException({ code: 'PROGRAM_STRUCTURE_INVALID', message: 'At least one training day must contain an exercise' });
  }
  for (const day of trainable) {
    for (const exercise of day.exercises) {
      const setCount = Array.isArray(exercise.sets) ? exercise.sets.length : 0;
      const planned = Array.isArray(exercise.plannedSets) ? exercise.plannedSets.length : 0;
      if (setCount < 1 && planned < 1) throw new UnprocessableEntityException({ code: 'PROGRAM_STRUCTURE_INVALID', message: 'Each exercise must have at least one set' });
    }
  }
}

export function overlappingContraindications(exerciseTags: unknown, userTags: unknown) {
  const exercise = new Set((Array.isArray(exerciseTags) ? exerciseTags : []).map(String));
  return (Array.isArray(userTags) ? userTags : []).map(String).filter((tag) => exercise.has(tag));
}

export function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor?: string) {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso);
  if (!id || Number.isNaN(createdAt.getTime())) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid cursor', details: [{ field: 'cursor' }] });
  return { createdAt, id };
}
