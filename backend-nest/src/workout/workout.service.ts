import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, PrismaClient, UserStatus, WorkoutRestTimerStatus, WorkoutSessionStatus, WorkoutSetStatus, WorkoutStatus } from '@prisma/client';
import { calculateVolumeKg, recommendWeight } from './workout.calculations';

type Transition = 'start' | 'pause' | 'resume';
const activeStatuses: WorkoutStatus[] = [WorkoutStatus.IN_PROGRESS, WorkoutStatus.PAUSED];

@Injectable()
export class WorkoutService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, body: any, key?: string) {
    return this.idempotent(userId, key, { action: 'create', body }, async tx => {
      await this.assertUserActive(tx, userId);
      const active = await tx.workout.findFirst({ where: { userId, status: { in: activeStatuses } } });
      if (active) throw new ConflictException({ code: 'ACTIVE_WORKOUT_EXISTS', message: 'An active workout already exists' });
      const sourceType = body?.source?.type;
      if (!['MANUAL', 'PROGRAM', 'TEMPLATE'].includes(sourceType)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'source.type must be MANUAL, PROGRAM, or TEMPLATE' });
      const workout = await tx.workout.create({ data: { userId, source: sourceType, status: WorkoutStatus.DRAFT, title: String(body.title || 'Новая тренировка').slice(0, 255), scheduledFor: new Date() } });
      if (sourceType === 'PROGRAM') await this.snapshotProgram(tx, userId, workout.id, body.source.programWorkoutId);
      if (sourceType === 'TEMPLATE') await this.snapshotTemplate(tx, userId, workout.id, body.source.templateId);
      await this.audit(tx, userId, 'WORKOUT_CREATED', workout.id);
      return { data: this.creationResponse(workout) };
    }, 201);
  }

  async get(userId: string, workoutId: string) {
    const workout = await this.findOwned(this.prisma, userId, workoutId);
    await this.attachPerformanceHints(this.prisma, userId, workout);
    return { data: this.serialize(workout) };
  }

  async transition(userId: string, workoutId: string, action: Transition, key?: string) {
    return this.idempotent(userId, key, { workoutId, transition: action }, async tx => {
      const workout = await this.findOwned(tx, userId, workoutId);
      await this.assertUserActive(tx, userId);
      const now = new Date();
      if (action === 'start') {
        if (!( [WorkoutStatus.DRAFT, WorkoutStatus.PLANNED] as WorkoutStatus[]).includes(workout.status)) throw this.invalidState();
        await tx.workout.update({ where: { id: workoutId }, data: { status: WorkoutStatus.IN_PROGRESS, startedAt: now, version: { increment: 1 } } });
        await tx.workoutSession.upsert({ where: { workoutId }, create: { workoutId, status: WorkoutSessionStatus.IN_PROGRESS, startedAt: now }, update: { status: WorkoutSessionStatus.IN_PROGRESS, pausedAt: null, version: { increment: 1 } } });
      } else if (action === 'pause') {
        if (workout.status !== WorkoutStatus.IN_PROGRESS) throw this.invalidState();
        await tx.workout.update({ where: { id: workoutId }, data: { status: WorkoutStatus.PAUSED, version: { increment: 1 } } });
        await tx.workoutSession.update({ where: { workoutId }, data: { status: WorkoutSessionStatus.PAUSED, pausedAt: now, version: { increment: 1 } } });
      } else {
        if (workout.status !== WorkoutStatus.PAUSED) throw this.invalidState();
        const pausedSeconds = workout.sessions[0]?.pausedAt ? Math.max(0, Math.round((now.getTime() - workout.sessions[0].pausedAt.getTime()) / 1000)) : 0;
        await tx.workout.update({ where: { id: workoutId }, data: { status: WorkoutStatus.IN_PROGRESS, pausedDurationSeconds: { increment: pausedSeconds }, version: { increment: 1 } } });
        await tx.workoutSession.update({ where: { workoutId }, data: { status: WorkoutSessionStatus.IN_PROGRESS, pausedAt: null, version: { increment: 1 } } });
      }
      await this.audit(tx, userId, `WORKOUT_${action.toUpperCase()}ED`, workoutId);
      return { data: this.serialize(await this.findOwned(tx, userId, workoutId)) };
    });
  }

  async updateSet(userId: string, workoutId: string, exerciseId: string, setId: string, body: any) {
    return this.prisma.$transaction(async tx => {
      const workout = await this.assertMutable(tx, userId, workoutId, body.workoutVersion);
      const set = await tx.workoutSet.findFirst({ where: { id: setId, exerciseId, exercise: { workoutId } } });
      if (!set) throw new NotFoundException({ code: 'WORKOUT_SET_NOT_FOUND', message: 'Workout set was not found' });
      this.validateSet({ ...set, ...body }, body.status ?? set.status);
      const data: any = this.pickSetFields(body);
      if (data.status === WorkoutSetStatus.COMPLETED) data.completedAt = new Date();
      if (data.status === WorkoutSetStatus.SKIPPED) Object.assign(data, { actualWeightKg: null, actualReps: null, rpe: null, rir: null, completedAt: null });
      await tx.workoutSet.update({ where: { id: setId }, data: { ...data, version: { increment: 1 } } });
      if (data.status === WorkoutSetStatus.COMPLETED && set.restSeconds > 0) await tx.workoutRestTimer.upsert({ where: { workoutId }, create: { workoutId, durationSeconds: set.restSeconds, endsAt: new Date(Date.now() + set.restSeconds * 1000) }, update: { status: WorkoutRestTimerStatus.RUNNING, durationSeconds: set.restSeconds, endsAt: new Date(Date.now() + set.restSeconds * 1000), pausedRemainingSeconds: null } });
      await this.bump(tx, workout);
      await this.audit(tx, userId, 'WORKOUT_SET_UPDATED', setId);
      return { data: this.serialize(await this.findOwned(tx, userId, workoutId)) };
    });
  }

  async addSet(userId: string, workoutId: string, exerciseId: string, body: any, key?: string) {
    return this.idempotent(userId, key, { workoutId, exerciseId, body }, async tx => {
      const workout = await this.assertMutable(tx, userId, workoutId, body.workoutVersion);
      const exercise = await tx.workoutExercise.findFirst({ where: { id: exerciseId, workoutId } });
      if (!exercise) throw new NotFoundException({ code: 'WORKOUT_EXERCISE_NOT_FOUND', message: 'Workout exercise was not found' });
      const last = await tx.workoutSet.aggregate({ where: { exerciseId }, _max: { position: true } });
      await tx.workoutSet.create({ data: { exerciseId, position: (last._max.position || 0) + 1, setType: body.setType || 'WORKING', plannedReps: body.plannedReps ?? null, plannedWeightKg: body.plannedWeightKg ?? null, restSeconds: body.restSeconds ?? 0 } });
      await this.bump(tx, workout);
      await this.audit(tx, userId, 'WORKOUT_SET_ADDED', exerciseId);
      return { data: this.serialize(await this.findOwned(tx, userId, workoutId)) };
    });
  }

  async skipSet(userId: string, workoutId: string, exerciseId: string, setId: string, body: any, key?: string) {
    return this.idempotent(userId, key, { workoutId, exerciseId, setId, body }, () => this.updateSet(userId, workoutId, exerciseId, setId, { ...body, status: WorkoutSetStatus.SKIPPED }));
  }

  async restoreSet(userId: string, workoutId: string, exerciseId: string, setId: string, body: any, key?: string) {
    return this.idempotent(userId, key, { workoutId, exerciseId, setId, body, action: 'restore' }, () => this.updateSet(userId, workoutId, exerciseId, setId, { ...body, status: WorkoutSetStatus.PLANNED, skipReason: null, actualWeightKg: null, actualReps: null, rpe: null, rir: null }));
  }

  async deleteSet(userId: string, workoutId: string, exerciseId: string, setId: string, body: any, key?: string) {
    return this.idempotent(userId, key, { workoutId, exerciseId, setId, body, action: 'delete-set' }, async tx => {
      const workout = await this.assertMutable(tx, userId, workoutId, body.workoutVersion);
      const sets = await tx.workoutSet.findMany({ where: { exerciseId, exercise: { workoutId } }, orderBy: { position: 'asc' } });
      if (!sets.some(set => set.id === setId)) throw new NotFoundException({ code: 'WORKOUT_SET_NOT_FOUND', message: 'Workout set was not found' });
      if (sets.length < 2) throw new ConflictException({ code: 'LAST_SET_CANNOT_BE_DELETED', message: 'The last set cannot be deleted' });
      await tx.workoutSet.delete({ where: { id: setId } });
      await this.bump(tx, workout); await this.audit(tx, userId, 'WORKOUT_SET_DELETED', setId);
      return { data: this.serialize(await this.findOwned(tx, userId, workoutId)) };
    });
  }

  async addExercise(userId: string, workoutId: string, body: any, key?: string) {
    return this.idempotent(userId, key, { workoutId, body, action: 'add-exercise' }, async tx => {
      const workout = await this.assertMutable(tx, userId, workoutId, body.workoutVersion);
      const catalog = await tx.exerciseCatalogItem.findFirst({ where: { id: body.exerciseId, active: true } });
      if (!catalog) throw new NotFoundException({ code: 'EXERCISE_NOT_FOUND', message: 'Exercise was not found' });
      const last = await tx.workoutExercise.aggregate({ where: { workoutId }, _max: { position: true } });
      const hint = await this.performanceHint(tx, userId, catalog.id, catalog.equipment);
      const exercise = await tx.workoutExercise.create({ data: { workoutId, position: (last._max.position || 0) + 1, title: catalog.title, muscleGroup: catalog.muscleGroup, equipment: catalog.equipment, techniqueUrl: catalog.techniqueUrl, catalogExerciseId: catalog.id, lastPerformance: hint.lastPerformance ? this.jsonPerformance(hint.lastPerformance) : Prisma.JsonNull, recommendedWeightKg: hint.recommendedWeightKg } });
      await tx.workoutSet.create({ data: { exerciseId: exercise.id, position: 1, setType: 'WORKING', plannedReps: body.plannedReps ?? null, plannedWeightKg: body.plannedWeightKg ?? null, restSeconds: body.restSeconds ?? 0 } });
      await this.bump(tx, workout); await this.audit(tx, userId, 'WORKOUT_EXERCISE_ADDED', exercise.id);
      return { data: this.serialize(await this.findOwned(tx, userId, workoutId)) };
    });
  }

  async deleteExercise(userId: string, workoutId: string, exerciseId: string, body: any, key?: string) {
    return this.idempotent(userId, key, { workoutId, exerciseId, body, action: 'delete-exercise' }, async tx => {
      const workout = await this.assertMutable(tx, userId, workoutId, body.workoutVersion);
      const exercise = await tx.workoutExercise.findFirst({ where: { id: exerciseId, workoutId }, include: { sets: true } });
      if (!exercise) throw new NotFoundException({ code: 'WORKOUT_EXERCISE_NOT_FOUND', message: 'Workout exercise was not found' });
      if (exercise.sets.some(set => set.status === WorkoutSetStatus.COMPLETED) && !body.confirmCompletedSets) throw new UnprocessableEntityException({ code: 'EXERCISE_HAS_COMPLETED_SETS', message: 'Confirmation is required to delete completed sets' });
      await tx.workoutExercise.update({ where: { id: exerciseId }, data: { status: 'REMOVED', version: { increment: 1 } } });
      await this.bump(tx, workout); await this.audit(tx, userId, 'WORKOUT_EXERCISE_REMOVED', exerciseId);
      return { data: this.serialize(await this.findOwned(tx, userId, workoutId)) };
    });
  }

  async replaceExercise(userId: string, workoutId: string, exerciseId: string, body: any, key?: string) {
    return this.idempotent(userId, key, { workoutId, exerciseId, body, action: 'replace-exercise' }, async tx => {
      const workout = await this.assertMutable(tx, userId, workoutId, body.workoutVersion);
      const original = await tx.workoutExercise.findFirst({ where: { id: exerciseId, workoutId } });
      const replacement = await tx.exerciseCatalogItem.findFirst({ where: { id: body.replacementExerciseId, active: true } });
      if (!original || !replacement) throw new UnprocessableEntityException({ code: 'EXERCISE_REPLACEMENT_NOT_ALLOWED', message: 'Replacement is not available' });
      if (original.muscleGroup && replacement.muscleGroup !== original.muscleGroup) throw new UnprocessableEntityException({ code: 'EXERCISE_REPLACEMENT_NOT_ALLOWED', message: 'Replacement must target the same muscle group' });
      const last = await tx.workoutExercise.aggregate({ where: { workoutId }, _max: { position: true } });
      const hint = await this.performanceHint(tx, userId, replacement.id, replacement.equipment);
      const newExercise = await tx.workoutExercise.create({ data: { workoutId, position: (last._max.position || 0) + 1, title: replacement.title, muscleGroup: replacement.muscleGroup, equipment: replacement.equipment, techniqueUrl: replacement.techniqueUrl, catalogExerciseId: replacement.id, lastPerformance: hint.lastPerformance ? this.jsonPerformance(hint.lastPerformance) : Prisma.JsonNull, recommendedWeightKg: hint.recommendedWeightKg } });
      await tx.workoutSet.create({ data: { exerciseId: newExercise.id, position: 1, setType: 'WORKING' } });
      await tx.workoutExercise.update({ where: { id: original.id }, data: { status: 'REPLACED', replacedByExerciseId: newExercise.id } });
      await tx.workoutExerciseReplacement.create({ data: { workoutId, originalExerciseId: original.id, replacementExerciseId: newExercise.id } });
      await this.bump(tx, workout); await this.audit(tx, userId, 'WORKOUT_EXERCISE_REPLACED', original.id);
      return { data: this.serialize(await this.findOwned(tx, userId, workoutId)) };
    });
  }

  async restTimer(userId: string, workoutId: string, action: 'start' | 'pause' | 'resume' | 'skip' | 'extend', body: any, key?: string) {
    return this.idempotent(userId, key, { workoutId, action, body }, async tx => {
      const workout = await this.assertMutable(tx, userId, workoutId, body.workoutVersion);
      const now = new Date();
      const timer = await tx.workoutRestTimer.findUnique({ where: { workoutId } });
      if (action === 'start') {
        const seconds = Number(body.durationSeconds);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'durationSeconds must be between 1 and 3600' });
        await tx.workoutRestTimer.upsert({ where: { workoutId }, create: { workoutId, durationSeconds: seconds, endsAt: new Date(now.getTime() + seconds * 1000) }, update: { status: WorkoutRestTimerStatus.RUNNING, durationSeconds: seconds, endsAt: new Date(now.getTime() + seconds * 1000), pausedRemainingSeconds: null } });
      } else if (!timer) throw new NotFoundException({ code: 'REST_TIMER_NOT_FOUND', message: 'Rest timer was not found' });
      else if (action === 'pause') {
        const remaining = Math.max(0, Math.ceil(((timer.endsAt?.getTime() || now.getTime()) - now.getTime()) / 1000));
        await tx.workoutRestTimer.update({ where: { workoutId }, data: { status: WorkoutRestTimerStatus.PAUSED, pausedRemainingSeconds: remaining, endsAt: null } });
      } else if (action === 'resume') {
        const remaining = timer.pausedRemainingSeconds || 0;
        await tx.workoutRestTimer.update({ where: { workoutId }, data: { status: WorkoutRestTimerStatus.RUNNING, endsAt: new Date(now.getTime() + remaining * 1000), pausedRemainingSeconds: null } });
      } else if (action === 'extend') {
        const seconds = Number(body.seconds);
        if (![15, 30, 60].includes(seconds)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'seconds must be 15, 30, or 60' });
        const endsAt = timer.endsAt ? new Date(timer.endsAt.getTime() + seconds * 1000) : new Date(now.getTime() + ((timer.pausedRemainingSeconds || 0) + seconds) * 1000);
        await tx.workoutRestTimer.update({ where: { workoutId }, data: timer.status === WorkoutRestTimerStatus.PAUSED ? { pausedRemainingSeconds: (timer.pausedRemainingSeconds || 0) + seconds, durationSeconds: { increment: seconds } } : { status: WorkoutRestTimerStatus.RUNNING, endsAt, durationSeconds: { increment: seconds } } });
      } else await tx.workoutRestTimer.update({ where: { workoutId }, data: { status: WorkoutRestTimerStatus.SKIPPED, endsAt: null, pausedRemainingSeconds: null } });
      await this.bump(tx, workout);
      return { data: this.serialize(await this.findOwned(tx, userId, workoutId)) };
    });
  }

  async complete(userId: string, workoutId: string, body: any, key?: string) {
    const response = await this.idempotent(userId, key, { workoutId, body }, async tx => {
      const workout = await this.assertMutable(tx, userId, workoutId, body.workoutVersion);
      const incomplete = workout.exercises.flatMap((exercise: any) => exercise.sets).filter((set: any) => set.status === WorkoutSetStatus.PLANNED);
      if (incomplete.length && !body.completeWithIncompleteSets) throw new UnprocessableEntityException({ code: 'WORKOUT_HAS_INCOMPLETE_SETS', message: 'Workout has incomplete sets' });
      const now = new Date();
      const sets = workout.exercises.flatMap((exercise: any) => exercise.sets);
      const volume = calculateVolumeKg(sets.map((set: any) => ({ status: set.status, actualWeightKg: Number(set.actualWeightKg || 0), actualReps: set.actualReps })));
      const durationSeconds = workout.startedAt ? Math.max(0, Math.round((now.getTime() - workout.startedAt.getTime()) / 1000) - workout.pausedDurationSeconds) : 0;
      await tx.workout.update({ where: { id: workoutId }, data: { status: WorkoutStatus.COMPLETED, completedAt: now, durationSeconds, totalVolumeKg: volume, version: { increment: 1 } } });
      await tx.workoutSession.updateMany({ where: { workoutId }, data: { status: WorkoutSessionStatus.COMPLETED, completedAt: now, durationSeconds, version: { increment: 1 } } });
      await tx.dashboardSnapshot.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'INVALIDATED', invalidatedAt: now } });
      await tx.outboxEvent.create({ data: { userId, type: 'workout.completed', payload: { workoutId } } });
      await this.audit(tx, userId, 'WORKOUT_COMPLETED', workoutId);
      const completedSets = sets.filter((set: any) => set.status === WorkoutSetStatus.COMPLETED).length;
      const skippedSets = sets.filter((set: any) => set.status === WorkoutSetStatus.SKIPPED).length;
      return { data: { id: workoutId, status: WorkoutStatus.COMPLETED, startedAt: workout.startedAt, completedAt: now, durationMinutes: Math.round(durationSeconds / 60), summary: { exerciseCount: workout.exercises.length, completedSets, skippedSets, totalVolumeKg: volume, personalRecords: [], calculationStatus: 'PENDING' }, nextAction: { type: 'GO_TO_DASHBOARD', deepLink: '/' } } };
    });
    return response;
  }

  async cancel(userId: string, workoutId: string, body: any, key?: string) {
    return this.idempotent(userId, key, { workoutId, body, action: 'cancel' }, async tx => {
      const workout = await this.findOwned(tx, userId, workoutId);
      await this.assertUserActive(tx, userId);
      if (![WorkoutStatus.DRAFT, ...activeStatuses].includes(workout.status)) throw this.invalidState();
      if (body.workoutVersion !== workout.version) throw new ConflictException({ code: 'WORKOUT_VERSION_CONFLICT', message: 'Тренировка была изменена в другом сеансе.' });
      await tx.workout.update({ where: { id: workoutId }, data: { status: WorkoutStatus.CANCELLED, cancelledAt: new Date(), version: { increment: 1 } } });
      await tx.workoutSession.updateMany({ where: { workoutId }, data: { status: WorkoutSessionStatus.CANCELLED } });
      await this.audit(tx, userId, 'WORKOUT_CANCELLED', workoutId);
      return { data: this.serialize(await this.findOwned(tx, userId, workoutId)) };
    });
  }

  private async assertMutable(tx: Prisma.TransactionClient, userId: string, workoutId: string, version: unknown) {
    const workout = await this.findOwned(tx, userId, workoutId);
    await this.assertUserActive(tx, userId);
    if (!activeStatuses.includes(workout.status)) throw this.invalidState();
    if (!Number.isInteger(version) || version !== workout.version) throw new ConflictException({ code: 'WORKOUT_VERSION_CONFLICT', message: 'Тренировка была изменена в другом сеансе.', details: [{ workout: this.serialize(workout) }] });
    return workout;
  }

  private async findOwned(tx: PrismaClient | Prisma.TransactionClient, userId: string, workoutId: string) {
    const workout = await tx.workout.findFirst({ where: { id: workoutId, userId }, include: { sessions: true, restTimer: true, exercises: { where: { status: { not: 'REMOVED' } }, orderBy: { position: 'asc' }, include: { sets: { orderBy: { position: 'asc' } } } } } });
    if (!workout) throw new NotFoundException({ code: 'WORKOUT_NOT_FOUND', message: 'Workout was not found' });
    return workout;
  }

  private async assertUserActive(tx: Prisma.TransactionClient, userId: string) { const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } }); if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User was not found' }); if (user.status !== UserStatus.ACTIVE) throw new ForbiddenException({ code: 'ACCOUNT_UNAVAILABLE', message: 'User account cannot perform this operation' }); }
  private async snapshotProgram(tx: Prisma.TransactionClient, userId: string, workoutId: string, programWorkoutId: string | undefined) {
    const source = await tx.programWorkout.findFirst({ where: { id: programWorkoutId, program: { assignments: { some: { userId, status: 'ACTIVE' } } } }, include: { exercises: { orderBy: { position: 'asc' }, include: { exercise: true, sets: { orderBy: { setNumber: 'asc' } } } } } });
    if (!source) throw new NotFoundException({ code: 'PROGRAM_WORKOUT_NOT_FOUND', message: 'Program workout was not found' });
    await tx.workout.update({ where: { id: workoutId }, data: { title: source.title, programAssignmentId: (await tx.userProgramAssignment.findFirstOrThrow({ where: { userId, programId: source.programId, status: 'ACTIVE' } })).id } });
    for (const item of source.exercises) {
      const exercise = await tx.workoutExercise.create({ data: { workoutId, position: item.position, title: item.exercise.title, muscleGroup: item.exercise.muscleGroup, equipment: item.exercise.equipment, techniqueUrl: item.exercise.techniqueUrl, catalogExerciseId: item.exerciseId } });
      const planned = (item.sets?.length ? item.sets : (item.plannedSets as any[])) || [];
      const rows = planned.length ? planned : [{ plannedRepsMax: item.plannedRepsMax, plannedWeightKg: item.plannedWeightKg, restSeconds: item.restSeconds, setType: 'WORKING' }];
      for (const [index, set] of rows.entries()) await tx.workoutSet.create({ data: { exerciseId: exercise.id, position: index + 1, setType: set.setType || 'WORKING', plannedReps: set.plannedRepsMax ?? set.plannedRepsMin ?? set.reps ?? item.plannedRepsMax ?? null, plannedWeightKg: set.plannedWeightKg ?? set.weightKg ?? item.plannedWeightKg ?? null, restSeconds: set.restSeconds ?? item.restSeconds ?? 0 } });
    }
  }
  private async snapshotTemplate(tx: Prisma.TransactionClient, userId: string, workoutId: string, templateId: string | undefined) { const template = await tx.workoutTemplate.findFirst({ where: { id: templateId, OR: [{ userId }, { userId: null }] } }); if (!template) throw new NotFoundException({ code: 'WORKOUT_TEMPLATE_NOT_FOUND', message: 'Workout template was not found' }); await tx.workout.update({ where: { id: workoutId }, data: { title: template.title, templateId: template.id } }); for (const [index, item] of (template.exercises as any[]).entries()) { const exercise = await tx.workoutExercise.create({ data: { workoutId, position: index + 1, title: item.title, muscleGroup: item.muscleGroup ?? null, equipment: item.equipment ?? null, catalogExerciseId: item.exerciseId ?? null } }); for (const [setIndex, set] of (item.sets || [{ }]).entries()) await tx.workoutSet.create({ data: { exerciseId: exercise.id, position: setIndex + 1, setType: set.setType || 'WORKING', plannedReps: set.reps ?? null, plannedWeightKg: set.weightKg ?? null, restSeconds: set.restSeconds ?? 0 } }); } }
  private async attachPerformanceHints(tx: PrismaClient | Prisma.TransactionClient, userId: string, workout: any) { for (const exercise of workout.exercises) if (exercise.catalogExerciseId) { const hint = await this.performanceHint(tx, userId, exercise.catalogExerciseId, exercise.equipment); exercise.lastPerformance = hint.lastPerformance; exercise.recommendedWeightKg = hint.recommendedWeightKg; } }
  private async performanceHint(tx: PrismaClient | Prisma.TransactionClient, userId: string, catalogExerciseId: string, equipment: string | null) { const previous = await tx.workoutExercise.findFirst({ where: { catalogExerciseId, workout: { userId, status: WorkoutStatus.COMPLETED } }, orderBy: { workout: { completedAt: 'desc' } }, include: { workout: { select: { completedAt: true } }, sets: { where: { setType: 'WORKING' }, orderBy: { position: 'asc' } } } }); if (!previous) return { lastPerformance: null, recommendedWeightKg: null }; const completed = previous.sets.filter(set => set.status === WorkoutSetStatus.COMPLETED); const latest = completed[completed.length - 1]; const lastPerformance = latest ? { workoutCompletedAt: previous.workout.completedAt?.toISOString(), weightKg: latest.actualWeightKg, reps: latest.actualReps, sets: completed.length, rpe: latest.rpe } : null; const weight = latest?.actualWeightKg == null ? null : Number(latest.actualWeightKg); const recommendation = recommendWeight(weight, previous.sets.map(set => ({ status: set.status, actualWeightKg: set.actualWeightKg == null ? null : Number(set.actualWeightKg), actualReps: set.actualReps, rpe: set.rpe == null ? null : Number(set.rpe) })), equipment === 'DUMBBELL' || equipment === 'DUMBBELLS' ? 'DUMBBELL' : equipment === 'BARBELL' || equipment === 'MACHINE' ? 'BARBELL_OR_MACHINE' : 'OTHER'); return { lastPerformance, recommendedWeightKg: recommendation }; }
  private jsonPerformance(performance: any) { return Object.fromEntries(Object.entries(performance).map(([key, value]) => [key, typeof value === 'object' && value !== null && 'toNumber' in value ? (value as any).toNumber() : value])) as Prisma.InputJsonValue; }
  private async bump(tx: Prisma.TransactionClient, workout: any) { const result = await tx.workout.updateMany({ where: { id: workout.id, version: workout.version }, data: { version: { increment: 1 } } }); if (result.count !== 1) throw new ConflictException({ code: 'WORKOUT_VERSION_CONFLICT', message: 'Тренировка была изменена в другом сеансе.' }); }
  private async audit(tx: Prisma.TransactionClient, userId: string, action: string, entityId: string) { await tx.auditLog.create({ data: { actorUserId: userId, targetUserId: userId, action, entityType: 'WORKOUT', entityId } }); }
  private invalidState() { return new ConflictException({ code: 'INVALID_WORKOUT_STATE', message: 'The workout cannot be changed in its current state' }); }
  private creationResponse(workout: any) { return { id: workout.id, status: workout.status, title: workout.title, source: workout.source, version: workout.version, exerciseCount: 0, deepLink: `/workouts/${workout.id}` }; }
  private serialize(workout: any) { return { ...workout, progress: { completedSets: workout.exercises.flatMap((exercise: any) => exercise.sets).filter((set: any) => set.status === WorkoutSetStatus.COMPLETED).length }, activeRestTimer: workout.restTimer }; }
  private pickSetFields(body: any) { const fields = ['actualWeightKg', 'actualReps', 'rpe', 'rir', 'note', 'status', 'skipReason', 'restSeconds']; return Object.fromEntries(fields.filter(field => body[field] !== undefined).map(field => [field, body[field]])); }
  private validateSet(body: any, status: WorkoutSetStatus) { if (body.actualWeightKg !== undefined && body.actualWeightKg !== null && (!Number.isFinite(body.actualWeightKg) || body.actualWeightKg < 0 || body.actualWeightKg > 1000 || Math.round(body.actualWeightKg * 4) !== body.actualWeightKg * 4)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'actualWeightKg must be 0..1000 in 0.25 increments' }); if (body.actualReps !== undefined && body.actualReps !== null && (!Number.isInteger(body.actualReps) || body.actualReps < 0 || body.actualReps > 1000)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'actualReps must be an integer between 0 and 1000' }); if (body.rpe !== undefined && body.rpe !== null && (!Number.isFinite(body.rpe) || body.rpe < 1 || body.rpe > 10 || Math.round(body.rpe * 2) !== body.rpe * 2)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'rpe must be 1..10 in 0.5 increments' }); if (body.rir !== undefined && body.rir !== null && (!Number.isInteger(body.rir) || body.rir < 0 || body.rir > 10)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'rir must be an integer between 0 and 10' }); if (status === WorkoutSetStatus.COMPLETED && (body.actualReps === undefined || body.actualReps === null)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Completed set requires actualReps' }); }
  private async idempotent(userId: string, key: string | undefined, payload: unknown, operation: (tx: Prisma.TransactionClient) => Promise<any>, status = 200) { if (!key) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key is required' }); const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex'); return this.prisma.$transaction(async tx => { const previous = await tx.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } }); if (previous) { if (previous.requestHash !== hash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key was used with a different request' }); return previous.responseBody; } const response = await operation(tx); await tx.idempotencyKey.create({ data: { userId, key, requestHash: hash, responseStatus: status, responseBody: response, expiresAt: new Date(Date.now() + 86_400_000) } }); return response; }); }
}
