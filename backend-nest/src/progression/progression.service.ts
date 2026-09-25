import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PersonalRecordType, PersonalRecordUnit, Prisma, PrismaClient, WorkoutSetStatus, WorkoutStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { ALGORITHM_VERSION, CalculationSet, FORMULA_VERSION } from './progression.calculations';
import { LoadRecommendationService } from './load-recommendation.service';
import { OneRmCalculationService } from './one-rm-calculation.service';
import { PersonalRecordService } from './personal-record.service';
import { ProgressionMetricsService } from './progression-metrics.service';
import { VolumeCalculationService } from './volume-calculation.service';
import { ProgressionAuditService } from './progression-audit.service';
import { ProgressionHistoryService } from './progression-history.service';
import { ProgressionCacheService } from './progression-cache.service';

@Injectable()
export class ProgressionService {
  constructor(private readonly prisma: PrismaClient, private readonly volume: VolumeCalculationService, private readonly oneRm: OneRmCalculationService, private readonly records: PersonalRecordService, private readonly recommendations: LoadRecommendationService, private readonly metrics: ProgressionMetricsService, private readonly audit: ProgressionAuditService, private readonly history: ProgressionHistoryService, private readonly cache: ProgressionCacheService) {}

  async calculateCompletedWorkout(workoutId: string, algorithmVersion = ALGORITHM_VERSION, force = false) {
    const startedAt = Date.now();
    this.metrics.event('progression.workout_calculation_started', { workoutId, algorithmVersion });
    try {
      const result = await this.prisma.$transaction(tx => this.calculate(tx, workoutId, algorithmVersion, force));
      this.metrics.increment('progression_calculations_total', { status: 'success', algorithm_version: algorithmVersion });
      this.metrics.observe('progression_calculation_duration_ms', Date.now() - startedAt, { calculation_type: 'workout' });
      this.metrics.event('progression.workout_calculated', { workoutId, algorithmVersion, totalVolumeKg: result.totalVolumeKg, personalRecordsCount: result.personalRecords.length, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      this.metrics.increment('progression_calculations_total', { status: 'failed', algorithm_version: algorithmVersion });
      this.metrics.event('progression.workout_calculation_failed', { workoutId, algorithmVersion, durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  async getExercise(userId: string, exerciseId: string, periodDays = 90) {
    const cacheKey = `exercise:${exerciseId}:${periodDays}`;
    const cached = await this.cache.get<Awaited<ReturnType<ProgressionService['getExerciseUncached']>>>(userId, cacheKey);
    if (cached) return cached;
    const result = await this.getExerciseUncached(userId, exerciseId, periodDays);
    await this.cache.set(userId, cacheKey, result);
    return result;
  }

  async getExerciseForAdmin(actorUserId: string, targetUserId: string, exerciseId: string, periodDays: number, requestId: string, ipHash?: string) {
    const result = await this.getExercise(targetUserId, exerciseId, periodDays);
    await this.auditAdmin(actorUserId, targetUserId, 'ADMIN_PROGRESSION_VIEW', 'USER_PROGRESSION', exerciseId, requestId, ipHash, { periodDays });
    return result;
  }

  async getHistoryForAdmin(actorUserId: string, targetUserId: string, exerciseId: string, query: { cursor?: string; limit?: number; from?: string; to?: string }, meta: { requestId: string; ipHash?: string }) {
    const result = await this.getHistory(targetUserId, exerciseId, query.cursor, query.limit, query.from ? new Date(query.from) : undefined, query.to ? new Date(query.to) : undefined);
    await this.auditAdmin(actorUserId, targetUserId, 'ADMIN_PROGRESSION_HISTORY_VIEW', 'USER_PROGRESSION', exerciseId, meta.requestId, meta.ipHash, {});
    return result;
  }

  async getSummaryForAdmin(actorUserId: string, targetUserId: string, workoutId: string, meta: { requestId: string; ipHash?: string }) {
    const result = await this.getSummary(targetUserId, workoutId);
    await this.auditAdmin(actorUserId, targetUserId, 'ADMIN_PROGRESSION_SUMMARY_VIEW', 'WORKOUT', workoutId, meta.requestId, meta.ipHash, {});
    return result;
  }

  async revokePersonalRecord(actorUserId: string, recordId: string, reason: string, meta: { requestId: string; ipHash?: string }) {
    const record = await this.prisma.personalRecord.findUnique({ where: { id: recordId } });
    if (!record) throw new NotFoundException({ code: 'PERSONAL_RECORD_NOT_FOUND', message: 'Personal record was not found' });
    const updated = await this.prisma.personalRecord.update({ where: { id: recordId }, data: { revokedAt: new Date(), revokedReason: reason } });
    await this.auditAdmin(actorUserId, record.userId, 'ADMIN_PERSONAL_RECORD_REVOKED', 'PERSONAL_RECORD', recordId, meta.requestId, meta.ipHash, { reason });
    await this.cache.invalidateUser(record.userId);
    return updated;
  }

  private async getExerciseUncached(userId: string, exerciseId: string, periodDays = 90) {
    const exercise = await this.prisma.exerciseCatalogItem.findFirst({ where: { id: exerciseId, active: true } });
    if (!exercise) throw new NotFoundException({ code: 'EXERCISE_NOT_FOUND', message: 'Exercise was not found' });
    const since = new Date(Date.now() - periodDays * 86_400_000);
    const performances = await this.history.latest(userId, exerciseId);
    const records = await this.prisma.personalRecord.findMany({ where: { userId, exerciseId }, orderBy: { value: 'desc' } });
    const recommendation = await this.prisma.exerciseProgressionRecommendation.findUnique({ where: { userId_exerciseId_algorithmVersion: { userId, exerciseId, algorithmVersion: ALGORITHM_VERSION } } });
    const recent = await this.prisma.exercisePerformance.findMany({ where: { userId, exerciseId, performedAt: { gte: since } }, orderBy: { performedAt: 'asc' } });
    const last = performances[0]; const prior = performances[1];
    const lastSets = last ? await this.prisma.workoutSet.findMany({ where: { exercise: { workoutId: last.workoutId, catalogExerciseId: exerciseId }, status: WorkoutSetStatus.COMPLETED }, select: { rpe: true } }) : [];
    const maxRpe = lastSets.length ? Math.max(...lastSets.map(item => item.rpe == null ? 0 : Number(item.rpe))) : null;
    const max = (type: PersonalRecordType) => records.find(record => record.recordType === type);
    const maxReps = max('MAX_REPS');
    const maxRepsSet = maxReps?.sourceSetId ? await this.prisma.workoutSet.findUnique({ where: { id: maxReps.sourceSetId }, select: { actualWeightKg: true } }) : null;
    return { exercise: { id: exercise.id, title: exercise.title, equipmentType: exercise.equipment, weightIncrementKg: exercise.weightIncrementKg }, lastPerformance: last && { workoutId: last.workoutId, completedAt: last.performedAt, weightKg: last.maxWeightKg, reps: last.maxReps, sets: last.completedSetsCount, maxRpe, volumeKg: last.totalVolumeKg, estimated1RmKg: last.bestEstimated1RmKg }, personalRecords: { maxWeightKg: max('MAX_WEIGHT')?.value ?? null, maxReps: maxReps ? { weightKg: maxRepsSet?.actualWeightKg ?? null, reps: maxReps.value } : null, bestEstimated1RmKg: max('ESTIMATED_1RM')?.value ?? null, maxExerciseVolumeKg: max('MAX_EXERCISE_VOLUME')?.value ?? null }, recommendation: recommendation ? { status: recommendation.recommendedWeightKg == null ? 'INSUFFICIENT_DATA' : 'AVAILABLE', recommendedWeightKg: recommendation.recommendedWeightKg, targetRepsMin: recommendation.targetRepsMin, targetRepsMax: recommendation.targetRepsMax, targetRpe: recommendation.targetRpe, confidence: recommendation.confidence, reasonCode: recommendation.reasonCode, reason: this.recommendationReason(recommendation.reasonCode), algorithmVersion: recommendation.algorithmVersion, basedOnWorkoutId: recommendation.basedOnWorkoutId } : { status: 'INSUFFICIENT_DATA', recommendedWeightKg: null, confidence: 'NONE', reasonCode: 'INSUFFICIENT_DATA', reason: 'Недостаточно данных для безопасной рекомендации.', algorithmVersion: ALGORITHM_VERSION, basedOnWorkoutId: null }, trend: { volumeChangePercent: this.change(last?.totalVolumeKg, prior?.totalVolumeKg), estimated1RmChangePercent: this.change(last?.bestEstimated1RmKg, prior?.bestEstimated1RmKg), periodDays, samples: recent.length } };
  }

  async getHistory(userId: string, exerciseId: string, cursor?: string, limit = 20, from?: Date, to?: Date) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid history query parameters' });
    const parsedLimit = limit || 20;
    const cursorRow = cursor ? await this.prisma.exercisePerformance.findFirst({ where: { id: cursor, userId, exerciseId }, select: { id: true, performedAt: true } }) : null;
    if (cursor && !cursorRow) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid history cursor' });
    const cursorFilter = cursorRow ? { OR: [{ performedAt: { lt: cursorRow.performedAt } }, { performedAt: cursorRow.performedAt, id: { lt: cursorRow.id } }] } : {};
    const rows = await this.prisma.exercisePerformance.findMany({ where: { userId, exerciseId, performedAt: { gte: from, lte: to }, ...cursorFilter }, orderBy: [{ performedAt: 'desc' }, { id: 'desc' }], take: parsedLimit + 1 });
    const items = rows.slice(0, parsedLimit);
    return { items, nextCursor: rows.length > parsedLimit ? items.at(-1)?.id : null };
  }

  async getSummary(userId: string, workoutId: string) {
    const workout = await this.prisma.workout.findFirst({ where: { id: workoutId, userId }, select: { id: true, status: true } });
    if (!workout) throw new NotFoundException({ code: 'WORKOUT_NOT_FOUND', message: 'Workout was not found' });
    if (workout.status !== WorkoutStatus.COMPLETED) throw new ConflictException({ code: 'WORKOUT_NOT_COMPLETED', message: 'Workout must be completed' });
    const calculation = await this.prisma.workoutCalculation.findFirst({ where: { workoutId, userId } });
    if (!calculation) throw new UnprocessableEntityException({ code: 'INSUFFICIENT_DATA', message: 'Workout calculation is not available yet' });
    const [performances, records] = await Promise.all([this.prisma.exercisePerformance.findMany({ where: { userId, workoutId } }), this.prisma.personalRecord.findMany({ where: { userId, sourceWorkoutId: workoutId } })]);
    return { workoutId, status: 'COMPLETED', totalVolumeKg: calculation.totalVolumeKg, exerciseCount: performances.length, completedSets: calculation.completedSetsCount, skippedSets: calculation.skippedSetsCount, estimated1RmResults: performances.filter(item => item.bestEstimated1RmKg != null).map(item => ({ exerciseId: item.exerciseId, bestEstimated1RmKg: item.bestEstimated1RmKg })), personalRecords: records.map(item => ({ type: item.recordType, exerciseId: item.exerciseId, previousValue: item.previousValue, newValue: item.value })), calculationVersion: calculation.calculationVersion, formulaVersion: calculation.formulaVersion, calculatedAt: calculation.calculatedAt };
  }

  async getWeeklyVolume(userId: string, date: Date) {
    const user = await this.prisma.userProfile.findUnique({ where: { userId }, select: { timezone: true } });
    const timezone = user?.timezone || 'UTC';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(date).filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
    const day = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
    const mondayOffset = (day.getUTCDay() + 6) % 7;
    const localStart = new Date(day.getTime() - mondayOffset * 86_400_000);
    const localEnd = new Date(localStart.getTime() + 7 * 86_400_000);
    const offset = (instant: Date) => {
      const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant).filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
      return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second)) - instant.getTime();
    };
    const start = new Date(localStart.getTime() - offset(localStart));
    const end = new Date(localEnd.getTime() - offset(localEnd));
    const rows = await this.prisma.workoutCalculation.findMany({ where: { userId, workout: { completedAt: { gte: start, lt: end } } }, select: { totalVolumeKg: true } });
    const total = rows.every(row => row.totalVolumeKg != null) ? rows.reduce((sum, row) => sum + Number(row.totalVolumeKg || 0), 0) : null;
    return { timezone, weekStart: start, weekEnd: end, totalVolumeKg: total, workoutCount: rows.length };
  }

  async recalculate(actor: { userId: string; roles: string[] }, workoutId: string, body: { algorithmVersion?: string; reason?: string }, key?: string) {
    if (!actor.roles.includes('SUPER_ADMIN') && !actor.roles.includes('SYSTEM')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Manual recalculation requires elevated access' });
    if (!key) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key is required' });
    const hash = createHash('sha256').update(JSON.stringify({ workoutId, body })).digest('hex');
    return this.prisma.$transaction(async tx => {
      const previous = await tx.idempotencyKey.findUnique({ where: { userId_key: { userId: actor.userId, key } } });
      if (previous) { if (previous.requestHash !== hash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key was used with a different request' }); return previous.responseBody; }
      await this.audit.recordRecalculation(tx, actor.userId, workoutId, body.reason || 'UNSPECIFIED', body.algorithmVersion || ALGORITHM_VERSION);
      this.metrics.event('progression.recalculation_requested', { workoutId, actorUserId: actor.userId, algorithmVersion: body.algorithmVersion || ALGORITHM_VERSION });
      const response = await this.calculate(tx, workoutId, body.algorithmVersion || ALGORITHM_VERSION, true);
      await tx.idempotencyKey.create({ data: { userId: actor.userId, key, requestHash: hash, responseStatus: 200, responseBody: response, expiresAt: new Date(Date.now() + 86_400_000) } });
      this.metrics.event('progression.recalculation_completed', { workoutId, actorUserId: actor.userId, algorithmVersion: body.algorithmVersion || ALGORITHM_VERSION });
      return response;
    });
  }

  private async calculate(tx: Prisma.TransactionClient, workoutId: string, algorithmVersion: string, force: boolean) {
    if (algorithmVersion !== ALGORITHM_VERSION) throw new UnprocessableEntityException({ code: 'INSUFFICIENT_DATA', message: 'Unsupported algorithm version' });
    const workout = await tx.workout.findUnique({ where: { id: workoutId }, include: { exercises: { include: { sets: true } } } });
    if (!workout) throw new NotFoundException({ code: 'WORKOUT_NOT_FOUND', message: 'Workout was not found' });
    if (workout.status !== WorkoutStatus.COMPLETED || !workout.completedAt) throw new ConflictException({ code: 'WORKOUT_NOT_COMPLETED', message: 'Workout must be completed' });
    if (!force && await tx.workoutCalculation.findUnique({ where: { workoutId } })) return this.getCalculatedSummary(tx, workout.userId, workoutId);
    if (force) await tx.personalRecord.deleteMany({ where: { userId: workout.userId, sourceWorkoutId: workoutId } });
    const bodyweight = await tx.measurementValue.findFirst({ where: { metric: 'WEIGHT', value: { not: null }, measurement: { userId: workout.userId, measuredAt: { gte: new Date(workout.completedAt.getTime() - 30 * 86_400_000), lte: workout.completedAt } } }, orderBy: { measurement: { measuredAt: 'desc' } } });
    let totalVolume: number | null = 0, completedSets = 0, skippedSets = 0;
    const allRecords: any[] = [];
    for (const exercise of workout.exercises.filter(item => item.status === 'ACTIVE' && item.kind === 'STRENGTH' && item.catalogExerciseId)) {
      const catalog = await tx.exerciseCatalogItem.findUnique({ where: { id: exercise.catalogExerciseId! } }); if (!catalog) continue;
      const sets = exercise.sets as unknown as CalculationSet[];
      const valid = sets.filter(set => set.status === WorkoutSetStatus.COMPLETED && (set.actualReps || 0) > 0 && (set.actualWeightKg == null || Number(set.actualWeightKg) <= 1000));
      const isStaticBodyweightExercise = catalog.bodyweightLoadFactor != null && Number(catalog.bodyweightLoadFactor) === 0;
      const effectiveWeightForSet = (set: CalculationSet): number | null | undefined => {
        if (catalog.bodyweightLoadFactor == null) return undefined;
        if (isStaticBodyweightExercise || bodyweight?.value == null) return null;
        return Number(bodyweight.value) * Number(catalog.bodyweightLoadFactor) + Number(set.actualWeightKg || 0);
      };
      const bodyweightVolumes = valid.map(set => this.volume.calculateSet(set, effectiveWeightForSet(set)));
      const volume = catalog.bodyweightLoadFactor == null ? this.volume.calculateExercise(valid) : bodyweightVolumes.some(value => value == null) ? null : bodyweightVolumes.reduce<number>((sum, value) => sum + (value ?? 0), 0);
      this.metrics.event('progression.volume_calculated', { workoutId, exerciseId: catalog.id, volumeKg: volume });
      if (volume == null) totalVolume = null; else if (totalVolume != null) totalVolume += volume;
      completedSets += valid.length; skippedSets += sets.filter(set => set.status === 'SKIPPED').length;
      const weighted = valid.map(set => ({ set, weight: effectiveWeightForSet(set) === undefined ? set.actualWeightKg == null ? null : Number(set.actualWeightKg) : effectiveWeightForSet(set) }));
      const bestOneRm = Math.max(...weighted.map(item => this.oneRm.calculate(item.weight ?? null, item.set.actualReps) || 0), 0) || null;
      this.metrics.event('progression.estimated_1rm_calculated', { workoutId, exerciseId: catalog.id, estimated1RmKg: bestOneRm, formulaVersion: FORMULA_VERSION });
      const maxWeight = Math.max(...weighted.map(item => item.weight || 0), 0) || null;
      const maxReps = Math.max(...valid.map(set => set.actualReps || 0), 0) || null;
      await tx.exercisePerformance.upsert({ where: { userId_workoutId_exerciseId: { userId: workout.userId, workoutId, exerciseId: catalog.id } }, create: { userId: workout.userId, workoutId, exerciseId: catalog.id, performedAt: workout.completedAt, totalVolumeKg: volume, maxWeightKg: maxWeight, maxReps, bestEstimated1RmKg: bestOneRm, completedSetsCount: valid.length, skippedSetsCount: sets.filter(set => set.status === 'SKIPPED').length, calculationVersion: algorithmVersion, formulaVersion: FORMULA_VERSION }, update: { totalVolumeKg: volume, maxWeightKg: maxWeight, maxReps, bestEstimated1RmKg: bestOneRm, completedSetsCount: valid.length, skippedSetsCount: sets.filter(set => set.status === 'SKIPPED').length, calculationVersion: algorithmVersion, formulaVersion: FORMULA_VERSION } });
      if (maxWeight) allRecords.push({ type: 'MAX_WEIGHT', value: maxWeight, unit: 'KG', exerciseId: catalog.id });
      const maxRepSet = weighted.filter(item => item.weight != null).sort((left, right) => (right.set.actualReps || 0) - (left.set.actualReps || 0))[0];
      if (maxRepSet?.weight != null && maxRepSet.set.actualReps) allRecords.push({ type: 'MAX_REPS', value: maxRepSet.set.actualReps, unit: 'REPS', exerciseId: catalog.id, sourceSetId: maxRepSet.set.id, comparisonWeightKg: maxRepSet.weight });
      if (bestOneRm) allRecords.push({ type: 'ESTIMATED_1RM', value: bestOneRm, unit: 'KG', exerciseId: catalog.id });
      if (volume != null) allRecords.push({ type: 'MAX_EXERCISE_VOLUME', value: volume, unit: 'KG_VOLUME', exerciseId: catalog.id });
      await this.recommendations.updateForExercise(tx, workout.userId, catalog.id, workoutId, sets, catalog.equipment, catalog.weightIncrementKg == null ? null : Number(catalog.weightIncrementKg));
    }
    if (totalVolume != null) allRecords.push({ type: 'MAX_WORKOUT_VOLUME', value: totalVolume, unit: 'KG_VOLUME', exerciseId: null });
    const personalRecords = await this.records.createNewRecords(tx, workout.userId, workoutId, workout.completedAt, algorithmVersion, allRecords);
    await tx.workoutCalculation.upsert({ where: { workoutId }, create: { workoutId, userId: workout.userId, totalVolumeKg: totalVolume, completedSetsCount: completedSets, skippedSetsCount: skippedSets, calculationVersion: algorithmVersion, formulaVersion: FORMULA_VERSION, calculatedAt: new Date() }, update: { totalVolumeKg: totalVolume, completedSetsCount: completedSets, skippedSetsCount: skippedSets, calculationVersion: algorithmVersion, formulaVersion: FORMULA_VERSION, calculatedAt: new Date(), version: { increment: 1 } } });
    for (const record of personalRecords) { this.metrics.increment('progression_personal_records_total', { record_type: record.type }); this.metrics.event('progression.personal_record_created', { workoutId, ...record }); }
    await this.cache.invalidateUser(workout.userId);
    await tx.outboxEvent.createMany({ data: [{ userId: workout.userId, type: 'progression.workout_calculated', payload: { workoutId, algorithmVersion } }, ...personalRecords.map(record => ({ userId: workout.userId, type: 'progression.personal_record_created', payload: record })), { userId: workout.userId, type: 'progression.recommendation_updated', payload: { workoutId } }] });
    return this.getCalculatedSummary(tx, workout.userId, workoutId);
  }

  private async getCalculatedSummary(tx: Prisma.TransactionClient, userId: string, workoutId: string) { const calculation = await tx.workoutCalculation.findUniqueOrThrow({ where: { workoutId } }); const [performances, records] = await Promise.all([tx.exercisePerformance.findMany({ where: { userId, workoutId } }), tx.personalRecord.findMany({ where: { userId, sourceWorkoutId: workoutId } })]); return { workoutId, totalVolumeKg: calculation.totalVolumeKg, completedSets: calculation.completedSetsCount, skippedSets: calculation.skippedSetsCount, calculationVersion: calculation.calculationVersion, formulaVersion: calculation.formulaVersion, calculatedAt: calculation.calculatedAt, estimated1RmResults: performances.map(item => ({ exerciseId: item.exerciseId, bestEstimated1RmKg: item.bestEstimated1RmKg })), personalRecords: records.map(item => ({ type: item.recordType, exerciseId: item.exerciseId, previousValue: item.previousValue, newValue: item.value })) }; }
  private change(current?: Prisma.Decimal | null, previous?: Prisma.Decimal | null) { return current != null && previous != null && !previous.isZero() ? Number((((current.minus(previous)).div(previous)).mul(100)).toFixed(1)) : null; }
  private recommendationReason(code: string) { return ({ PROGRESSIVE_OVERLOAD: 'Все рабочие подходы выполнены с умеренной нагрузкой.', MAINTAIN_LOAD: 'Сохраните текущий вес для закрепления результата.', REDUCE_LOAD: 'Рекомендуется снизить вес после тяжёлого или неполного выполнения.', PAIN_OR_DISCOMFORT: 'Не увеличивайте нагрузку при дискомфорте.', PLAN_VALUE: 'Использовано плановое значение, так как истории выполнения недостаточно.', INSUFFICIENT_DATA: 'Недостаточно данных для безопасной рекомендации.' } as Record<string, string>)[code] || 'Рекомендация рассчитана на основе последнего результата.'; }
  private async auditAdmin(actorUserId: string, targetUserId: string, action: string, entityType: string, entityId: string, requestId: string, ipHash: string | undefined, metadata: Record<string, unknown>) {
    await this.prisma.auditLog.create({ data: { actorUserId, targetUserId, action, entityType, entityId, requestId, ipHash, metadata: metadata as Prisma.InputJsonValue } });
    this.metrics.event('admin.progression.viewed', { actorUserId, targetUserId, action, entityId, requestId });
  }
}
