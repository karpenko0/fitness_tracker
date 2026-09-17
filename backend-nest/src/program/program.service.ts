import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, PrismaClient, ProgramStatus, ProgramType } from '@prisma/client';
import { EntitlementService } from './entitlement.service';
import { ExerciseCatalogService } from './exercise-catalog.service';
import { ProgramMetricsService } from './program-metrics.service';
import { ProgramRepository } from './program.repository';
import { assertEquipment, decodeCursor, encodeCursor, validateActivatableStructure, validateDayMeta, validateExercisePlan, validateProgramMeta } from './program.validation';
import { AddProgramExerciseDto, CreateProgramDayDto, CreateProgramDto, ProgramQueryDto, ReorderDto, UpdateProgramDto } from './dto/program.dto';

@Injectable()
export class ProgramService {
  constructor(private readonly prisma: PrismaClient, private readonly programRepository: ProgramRepository, private readonly entitlements: EntitlementService, private readonly catalog: ExerciseCatalogService, private readonly metrics: ProgramMetricsService) {}

  async list(userId: string, query: ProgramQueryDto) {
    const started = Date.now();
    const entitlement = await this.entitlements.get(userId);
    const limit = query.limit ?? 20;
    const cursor = decodeCursor(query.cursor);
    const equipment = query.equipment ? assertEquipment(query.equipment) : [];
    const cacheKey = `programs:${entitlement.plan}:${JSON.stringify(query)}`;
    const cached = this.metrics.getCached<any>(cacheKey);
    if (cached) return cached;
    const rows = await this.programRepository.findMany(userId, { ...query, equipment: equipment.join(',') });
    const filtered = rows.filter((row) => {
      const goal = row.goal || this.asList(row.goals)[0];
      const level = row.level || this.asList(row.levels)[0];
      const location = row.location || this.asList(row.locations)[0];
      const required = this.asList(row.requiredEquipment);
      if (entitlement.plan === 'FREE' && row.isProOnly) return false;
      if (query.isProOnly != null && row.isProOnly !== query.isProOnly) return false;
      if (query.goal && goal !== query.goal) return false;
      if (query.level && level !== query.level) return false;
      if (query.location && location !== query.location) return false;
      if (equipment.length && !required.every((item) => equipment.includes(item)) && !equipment.some((item) => required.includes(item))) return false;
      return true;
    });
    const page = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const result = { items: page.map((row) => this.summary(row, entitlement.plan)), nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id) : null, hasMore };
    this.metrics.setCached(cacheKey, result);
    this.metrics.observe('program_api_duration_ms', Date.now() - started, { endpoint: 'GET /programs', status_code: 200 });
    return result;
  }

  async get(userId: string, programId: string) {
    const program = await this.programRepository.findById(programId);
    if (!program) throw new NotFoundException({ code: 'PROGRAM_NOT_FOUND', message: 'Program was not found' });
    const entitlement = await this.entitlements.get(userId);
    const assignment = await this.programRepository.findUserAssignment(userId, programId);
    this.assertReadable(userId, program, entitlement.plan, assignment);
    return this.detail(program, { plan: entitlement.plan, isActive: Boolean(assignment), assignment });
  }

  async active(userId: string) {
    const assignment = await this.programRepository.findActiveAssignment(userId);
    if (!assignment) return { activeProgram: null };
    const entitlement = await this.entitlements.get(userId);
    return { activeProgram: this.detail(assignment.program, { plan: entitlement.plan, isActive: true, assignment }) };
  }

  async create(userId: string, dto: CreateProgramDto, key?: string) {
    return this.idempotent(userId, key, dto, async (tx) => {
      await this.entitlements.assertCanCreateCustomProgram(userId, tx);
      validateProgramMeta(dto);
      const program = await this.programRepository.create({
        owner: { connect: { id: userId } },
        type: ProgramType.USER_CUSTOM,
        status: ProgramStatus.DRAFT,
        title: dto.title.trim(),
        description: dto.description || '',
        goal: dto.goal,
        level: dto.level,
        location: dto.location,
        goals: [dto.goal],
        levels: [dto.level],
        locations: [dto.location],
        durationWeeks: dto.durationWeeks,
        workoutsPerWeek: dto.workoutsPerWeek,
        estimatedWorkoutDurationMinutes: dto.estimatedWorkoutDurationMinutes,
        durationMinutes: dto.estimatedWorkoutDurationMinutes,
        firstWorkoutTitle: dto.title.trim(),
      });
      await this.audit(tx, userId, 'program.created', program.id, { programType: 'USER_CUSTOM' });
      this.metrics.increment('programs_created_total', { type: 'USER_CUSTOM', plan: (await this.entitlements.get(userId, tx)).plan });
      this.metrics.event('program.created', { userId, programId: program.id, programType: 'USER_CUSTOM' });
      return this.detail(await this.load(program.id), { plan: (await this.entitlements.get(userId, tx)).plan, isActive: false });
    }, 201);
  }

  async update(userId: string, programId: string, dto: UpdateProgramDto, key?: string) {
    return this.idempotent(userId, key, { programId, dto }, async (tx) => {
      const program = await this.requireOwnedDraft(userId, programId, dto.version);
      validateProgramMeta(dto);
      await this.programRepository.update(programId, {
        ...(dto.title != null ? { title: dto.title.trim() } : {}),
        ...(dto.description != null ? { description: dto.description } : {}),
        ...(dto.goal != null ? { goal: dto.goal, goals: [dto.goal] } : {}),
        ...(dto.level != null ? { level: dto.level, levels: [dto.level] } : {}),
        ...(dto.location != null ? { location: dto.location, locations: [dto.location] } : {}),
        ...(dto.durationWeeks != null ? { durationWeeks: dto.durationWeeks } : {}),
        ...(dto.workoutsPerWeek != null ? { workoutsPerWeek: dto.workoutsPerWeek } : {}),
        ...(dto.estimatedWorkoutDurationMinutes != null ? { estimatedWorkoutDurationMinutes: dto.estimatedWorkoutDurationMinutes, durationMinutes: dto.estimatedWorkoutDurationMinutes } : {}),
      }, dto.version);
      await this.audit(tx, userId, 'program.updated', programId);
      this.metrics.event('program.updated', { userId, programId });
      return this.detail(await this.load(programId), { plan: (await this.entitlements.get(userId, tx)).plan, isActive: program.status === 'ACTIVE' });
    });
  }

  async addDay(userId: string, programId: string, dto: CreateProgramDayDto, key?: string) {
    return this.idempotent(userId, key, { programId, dto }, async (tx) => {
      await this.requireOwnedDraft(userId, programId, dto.version);
      validateDayMeta(dto);
      const days = await this.programRepository.findDays(programId);
      const last = days.length ? days[days.length - 1] : null;
      const day = await this.programRepository.createDay({
        program: { connect: { id: programId } },
        title: dto.title.trim(),
        description: dto.description ?? null,
        focus: dto.focus ?? null,
        scheduledWeekday: dto.scheduledWeekday ?? null,
        estimatedDurationMinutes: dto.estimatedDurationMinutes ?? 60,
        isRestDay: dto.isRestDay ?? false,
        position: (last?.position || 0) + 1,
      });
      await this.bump(programId, dto.version);
      return { day: this.serializeDay(day, []), version: dto.version + 1 };
    });
  }

  async addExercise(userId: string, programId: string, dayId: string, dto: AddProgramExerciseDto, key?: string) {
    return this.idempotent(userId, key, { programId, dayId, dto }, async (tx) => {
      await this.requireOwnedDraft(userId, programId, dto.version);
      const day = await this.programRepository.findDays(programId).then((days) => days.find((d) => d.id === dayId));
      if (!day) throw new NotFoundException({ code: 'PROGRAM_NOT_FOUND', message: 'Training day was not found' });
      const catalog = await this.catalog.assertUsable(tx, userId, dto.exerciseId);
      const exercises = await this.programRepository.findExercises(programId, dayId);
      if (exercises.some((item) => item.exerciseId === dto.exerciseId) && !dto.confirmDuplicate) {
        throw new ConflictException({ code: 'DUPLICATE_EXERCISE_CONFIRMATION_REQUIRED', message: 'Duplicate exercise in the same day requires confirmation' });
      }
      validateExercisePlan(dto);
      const last = exercises.length ? exercises[exercises.length - 1] : null;
      const plannedSets = dto.plannedSets ?? 3;
      const plannedRepsMin = dto.plannedRepsMin ?? 8;
      const plannedRepsMax = dto.plannedRepsMax ?? 12;
      const exercise = await this.programRepository.createExercise({
        programWorkout: { connect: { id: dayId } },
        exercise: { connect: { id: catalog.id } },
        position: (last?.position || 0) + 1,
        plannedSetsCount: plannedSets,
        plannedRepsMin,
        plannedRepsMax,
        plannedWeightKg: dto.plannedWeightKg ?? null,
        targetRpe: dto.targetRpe ?? null,
        restSeconds: dto.restSeconds ?? 90,
        allowReplacement: dto.allowReplacement ?? true,
        isOptional: dto.isOptional ?? false,
        note: dto.note ?? null,
        plannedSets: Array.from({ length: plannedSets }, (_, index) => ({ setNumber: index + 1, setType: 'WORKING', plannedRepsMin, plannedRepsMax, plannedWeightKg: dto.plannedWeightKg ?? null, targetRpe: dto.targetRpe ?? null, restSeconds: dto.restSeconds ?? 90 })),
      });
      for (let index = 0; index < plannedSets; index++) {
        await this.programRepository.createSet({ programExercise: { connect: { id: exercise.id } }, setNumber: index + 1, setType: 'WORKING', plannedRepsMin, plannedRepsMax, plannedWeightKg: dto.plannedWeightKg ?? null, targetRpe: dto.targetRpe ?? null, restSeconds: dto.restSeconds ?? 90 });
      }
      await this.bump(programId, dto.version);
      await this.audit(tx, userId, 'exercise.added_to_program', exercise.id, { programId, dayId });
      this.metrics.increment('exercise_added_to_program_total', { exercise_type: catalog.exerciseType });
      this.metrics.event('exercise.added_to_program', { userId, programId, exerciseId: catalog.id });
      return this.detail(await this.load(programId), { plan: (await this.entitlements.get(userId, tx)).plan, isActive: false });
    });
  }

  async reorderDays(userId: string, programId: string, dto: ReorderDto, key?: string) {
    return this.idempotent(userId, key, { programId, dto, kind: 'days' }, async (tx) => {
      await this.requireOwnedDraft(userId, programId, dto.version);
      const days = await this.programRepository.findDays(programId);
      this.assertReorder(days, dto.items);
      for (const item of dto.items) await this.programRepository.updateDayPosition(item.id, item.orderIndex);
      await this.bump(programId, dto.version);
      return this.detail(await this.load(programId), { plan: (await this.entitlements.get(userId, tx)).plan, isActive: false });
    });
  }

  async reorderExercises(userId: string, programId: string, dayId: string, dto: ReorderDto, key?: string) {
    return this.idempotent(userId, key, { programId, dayId, dto, kind: 'exercises' }, async (tx) => {
      await this.requireOwnedDraft(userId, programId, dto.version);
      const exercises = await this.programRepository.findExercises(programId, dayId);
      this.assertReorder(exercises, dto.items);
      for (const item of dto.items) await this.programRepository.updateExercisePosition(item.id, item.orderIndex);
      await this.bump(programId, dto.version);
      return this.detail(await this.load(programId), { plan: (await this.entitlements.get(userId, tx)).plan, isActive: false });
    });
  }

  async duplicateDay(userId: string, programId: string, dayId: string, dto: { version: number }, key?: string) {
    return this.idempotent(userId, key, { programId, dayId, dto, kind: 'dup-day' }, async (tx) => {
      await this.requireOwnedDraft(userId, programId, dto.version);
      const source = await this.programRepository.findDays(programId).then((days) => days.find((d) => d.id === dayId));
      if (!source) throw new NotFoundException({ code: 'PROGRAM_NOT_FOUND', message: 'Training day was not found' });
      const days = await this.programRepository.findDays(programId);
      const last = days.length ? days[days.length - 1] : null;
      const copy = await this.programRepository.createDay({
        program: { connect: { id: programId } },
        title: `${source.title} (copy)`,
        description: source.description,
        focus: source.focus,
        scheduledWeekday: source.scheduledWeekday,
        estimatedDurationMinutes: source.estimatedDurationMinutes,
        isRestDay: source.isRestDay,
        position: (last?.position || 0) + 1,
      });
      const exercises = await this.programRepository.findExercises(programId, dayId);
      for (const exercise of exercises) {
        const created = await this.programRepository.createExercise({
          programWorkout: { connect: { id: copy.id } },
          exercise: { connect: { id: exercise.exerciseId } },
          position: exercise.position,
          plannedSetsCount: exercise.plannedSetsCount,
          plannedRepsMin: exercise.plannedRepsMin,
          plannedRepsMax: exercise.plannedRepsMax,
          plannedWeightKg: exercise.plannedWeightKg,
          targetRpe: exercise.targetRpe,
          restSeconds: exercise.restSeconds,
          note: exercise.note,
          allowReplacement: exercise.allowReplacement,
          alternativeExerciseIds: exercise.alternativeExerciseIds ?? [],
          isOptional: exercise.isOptional,
          plannedSets: exercise.plannedSets ?? [],
        });
        const sets = await this.programRepository.findSets(exercise.id);
        for (const set of sets) {
          await this.programRepository.createSet({ programExercise: { connect: { id: created.id } }, setNumber: set.setNumber, setType: set.setType, plannedWeightKg: set.plannedWeightKg, plannedRepsMin: set.plannedRepsMin, plannedRepsMax: set.plannedRepsMax, targetRpe: set.targetRpe, restSeconds: set.restSeconds });
        }
      }
      await this.bump(programId, dto.version);
      return this.detail(await this.load(programId), { plan: (await this.entitlements.get(userId, tx)).plan, isActive: false });
    });
  }

  async duplicateExercise(userId: string, programId: string, dayId: string, exerciseId: string, dto: { version: number }, key?: string) {
    return this.idempotent(userId, key, { programId, dayId, exerciseId, dto, kind: 'dup-ex' }, async (tx) => {
      await this.requireOwnedDraft(userId, programId, dto.version);
      const source = await this.programRepository.findExercises(programId, dayId).then((exercises) => exercises.find((e) => e.id === exerciseId));
      if (!source) throw new NotFoundException({ code: 'PROGRAM_NOT_FOUND', message: 'Program exercise was not found' });
      const exercises = await this.programRepository.findExercises(programId, dayId);
      const last = exercises.length ? exercises[exercises.length - 1] : null;
      const created = await this.programRepository.createExercise({
        programWorkout: { connect: { id: dayId } },
        exercise: { connect: { id: source.exerciseId } },
        position: (last?.position || 0) + 1,
        plannedSetsCount: source.plannedSetsCount,
        plannedRepsMin: source.plannedRepsMin,
        plannedRepsMax: source.plannedRepsMax,
        plannedWeightKg: source.plannedWeightKg,
        targetRpe: source.targetRpe,
        restSeconds: source.restSeconds,
        note: source.note,
        allowReplacement: source.allowReplacement,
        alternativeExerciseIds: source.alternativeExerciseIds ?? [],
        isOptional: source.isOptional,
        plannedSets: source.plannedSets ?? [],
      });
      const sets = await this.programRepository.findSets(source.id);
      for (const set of sets) {
        await this.programRepository.createSet({ programExercise: { connect: { id: source.id } }, setNumber: set.setNumber, setType: set.setType, plannedWeightKg: set.plannedWeightKg, plannedRepsMin: set.plannedRepsMin, plannedRepsMax: set.plannedRepsMax, targetRpe: set.targetRpe, restSeconds: set.restSeconds });
      }
      await this.bump(programId, dto.version);
      return this.detail(await this.load(programId), { plan: (await this.entitlements.get(userId, tx)).plan, isActive: false });
    });
  }

  async deleteDay(userId: string, programId: string, dayId: string, dto: { version: number }, key?: string) {
    return this.idempotent(userId, key, { programId, dayId, dto, kind: 'del-day' }, async (tx) => {
      const program = await this.requireOwnedDraft(userId, programId, dto.version);
      const day = await this.programRepository.findDays(programId).then((days) => days.find((d) => d.id === dayId));
      if (!day) throw new NotFoundException({ code: 'PROGRAM_NOT_FOUND', message: 'Training day was not found' });
      await this.programRepository.deleteDay(dayId);
      await this.bump(programId, dto.version);
      return this.detail(await this.load(programId), { plan: (await this.entitlements.get(userId, tx)).plan, isActive: false });
    });
  }

  async deleteExercise(userId: string, programId: string, dayId: string, exerciseId: string, dto: { version: number }, key?: string) {
    return this.idempotent(userId, key, { programId, dayId, exerciseId, dto, kind: 'del-ex' }, async (tx) => {
      await this.requireOwnedDraft(userId, programId, dto.version);
      const exercise = await this.programRepository.findExercises(programId, dayId).then((exercises) => exercises.find((e) => e.id === exerciseId));
      if (!exercise) throw new NotFoundException({ code: 'PROGRAM_NOT_FOUND', message: 'Program exercise was not found' });
      await this.programRepository.deleteExercise(exerciseId);
      await this.bump(programId, dto.version);
      return this.detail(await this.load(programId), { plan: (await this.entitlements.get(userId, tx)).plan, isActive: false });
    });
  }

  async copy(userId: string, programId: string, key?: string) {
    return this.idempotent(userId, key, { programId, action: 'copy' }, async (tx) => {
      await this.entitlements.assertCanCreateCustomProgram(userId, tx);
      const source = await this.load(programId);
      const entitlement = await this.entitlements.get(userId, tx);
      if (source.isProOnly && entitlement.plan !== 'PRO') throw new ForbiddenException({ code: 'PRO_FEATURE_REQUIRED', message: 'Pro subscription is required' });
      if (!['SYSTEM', 'TEMPLATE', 'AUTO_ASSIGNED'].includes(source.type) && source.ownerId !== userId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Program cannot be copied' });
      const copy = await this.programRepository.create({ owner: { connect: { id: userId } }, type: ProgramType.USER_CUSTOM, status: ProgramStatus.DRAFT, title: `${source.title}`.slice(0, 120), description: source.description, goal: source.goal, level: source.level, location: source.location, goals: source.goals as any, levels: source.levels as any, locations: source.locations as any, durationWeeks: source.durationWeeks, workoutsPerWeek: source.workoutsPerWeek, estimatedWorkoutDurationMinutes: source.estimatedWorkoutDurationMinutes || source.durationMinutes, durationMinutes: source.durationMinutes, requiredEquipment: source.requiredEquipment as any, firstWorkoutTitle: source.firstWorkoutTitle });
      for (const day of source.workouts) {
        const createdDay = await this.programRepository.createDay({ program: { connect: { id: copy.id } }, title: day.title, description: day.description, focus: day.focus, scheduledWeekday: day.scheduledWeekday, estimatedDurationMinutes: day.estimatedDurationMinutes, isRestDay: day.isRestDay, position: day.position });
        for (const exercise of day.exercises) {
          const created = await this.programRepository.createExercise({ programWorkout: { connect: { id: createdDay.id } }, exercise: { connect: { id: exercise.exerciseId } }, position: exercise.position, plannedSetsCount: exercise.plannedSetsCount, plannedRepsMin: exercise.plannedRepsMin, plannedRepsMax: exercise.plannedRepsMax, plannedWeightKg: exercise.plannedWeightKg, targetRpe: exercise.targetRpe, restSeconds: exercise.restSeconds, note: exercise.note, allowReplacement: exercise.allowReplacement, alternativeExerciseIds: exercise.alternativeExerciseIds as any, isOptional: exercise.isOptional, plannedSets: exercise.plannedSets as any });
          for (const set of exercise.sets) await this.programRepository.createSet({ programExercise: { connect: { id: created.id } }, setNumber: set.setNumber, setType: set.setType, plannedWeightKg: set.plannedWeightKg, plannedRepsMin: set.plannedRepsMin, plannedRepsMax: set.plannedRepsMax, targetRpe: set.targetRpe, restSeconds: set.restSeconds });
        }
      }
      await this.audit(tx, userId, 'program.copied', copy.id, { sourceProgramId: programId });
      return this.detail(await this.load(copy.id), { plan: entitlement.plan, isActive: false });
    }, 201);
  }

  async activate(userId: string, programId: string, key?: string) {
    return this.idempotent(userId, key, { programId, action: 'activate' }, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
      const program = await this.load(programId);
      const entitlement = await this.entitlements.get(userId, tx);
      if (program.isProOnly && entitlement.plan !== 'PRO') {
        this.metrics.increment('program_free_limit_reached_total', { limit_type: 'pro_content' });
        this.metrics.event('program.pro_feature_blocked', { userId, programId });
        throw new ForbiddenException({ code: 'PRO_FEATURE_REQUIRED', message: 'Pro subscription is required' });
      }
      if (program.type === 'USER_CUSTOM' && program.ownerId !== userId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Cannot activate another user program' });
      if (!['USER_CUSTOM', 'SYSTEM', 'AUTO_ASSIGNED', 'TEMPLATE'].includes(program.type) && program.ownerId !== userId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Cannot activate this program' });
      }
      if (program.status === 'UNPUBLISHED' || (program.type === 'SYSTEM' && program.status !== 'PUBLISHED')) throw new NotFoundException({ code: 'PROGRAM_NOT_FOUND', message: 'Program was not found' });
      try { validateActivatableStructure(program); } catch (error) {
        this.metrics.increment('program_validation_failed_total', { reason: 'structure' });
        this.metrics.event('program.validation_failed', { userId, programId });
        throw error;
      }
      const existing = await this.programRepository.findUserAssignment(userId, programId);
      if (existing?.status === 'ACTIVE') throw new ConflictException({ code: 'PROGRAM_ALREADY_ACTIVE', message: 'Program is already active' });
      await this.programRepository.archiveAssignments(userId);
      await this.programRepository.updateStatus(programId, ProgramStatus.ARCHIVED);
      if (program.type === 'USER_CUSTOM') await this.entitlements.assertCanActivateCustomProgram(userId, tx);
      const assignment = await this.programRepository.upsertAssignment({ user: { connect: { id: userId } }, program: { connect: { id: programId } }, source: 'USER' });
      if (program.type === 'USER_CUSTOM') await this.programRepository.update(programId, { status: ProgramStatus.ACTIVE }, program.version);
      const firstDay = program.workouts.find((day: any) => !day.isRestDay && day.exercises.length);
      let workout = null;
      if (firstDay) {
        workout = await tx.workout.create({ data: { userId, programAssignmentId: assignment.id, source: 'PROGRAM', status: 'PLANNED', scheduledFor: new Date(), title: firstDay.title, estimatedDurationMinutes: firstDay.estimatedDurationMinutes } });
        await this.snapshotDay(tx, workout.id, firstDay);
      }
      await this.audit(tx, userId, 'program.activated', programId, { assignmentId: assignment.id });
      await tx.auditLog.create({ data: { actorUserId: userId, targetUserId: userId, action: 'program.assignment.created', entityType: 'PROGRAM_ASSIGNMENT', entityId: assignment.id } });
      this.metrics.increment('programs_activated_total', { type: program.type, plan: entitlement.plan });
      this.metrics.event('program.activated', { userId, programId, programType: program.type, subscriptionPlan: entitlement.plan });
      this.metrics.event('program.assignment.created', { userId, programId });
      return { program: this.detail(await this.load(programId), { plan: entitlement.plan, isActive: true, assignment }), assignment, firstWorkout: workout };
    });
  }

  async archive(userId: string, programId: string, key?: string) {
    return this.idempotent(userId, key, { programId, action: 'archive' }, async (tx) => {
      const program = await this.load(programId);
      if (program.ownerId !== userId && program.type === 'USER_CUSTOM') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Cannot archive another user program' });
      if (program.type !== 'USER_CUSTOM' && program.ownerId !== userId) {
        const assignment = await this.programRepository.findUserAssignment(userId, programId);
        if (!assignment) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Cannot archive this program' });
        await tx.userProgramAssignment.update({ where: { id: assignment.id }, data: { status: 'ARCHIVED' } });
      } else {
        if (program.status === 'ACTIVE') await this.programRepository.archiveAssignments(userId);
        await this.programRepository.updateStatus(programId, ProgramStatus.ARCHIVED);
      }
      await this.audit(tx, userId, 'program.archived', programId);
      this.metrics.increment('programs_archived_total', { type: program.type });
      this.metrics.event('program.archived', { userId, programId, programType: program.type });
      return { archived: true, programId };
    });
  }

  async startWorkoutFromDay(userId: string, programId: string, dayId: string, key?: string) {
    return this.idempotent(userId, key, { programId, dayId, action: 'start-day' }, async (tx) => {
      const assignment = await this.programRepository.findUserAssignment(userId, programId);
      if (!assignment || assignment.status !== 'ACTIVE') throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Program is not active for the user' });
      const days = await this.programRepository.findDays(programId);
      const day = days.find((d) => d.id === dayId);
      if (!day) throw new NotFoundException({ code: 'PROGRAM_NOT_FOUND', message: 'Training day was not found' });
      const active = await tx.workout.findFirst({ where: { userId, status: { in: ['IN_PROGRESS', 'PAUSED'] } } });
      if (active) throw new ConflictException({ code: 'ACTIVE_WORKOUT_EXISTS', message: 'An active workout already exists' });
      const workout = await tx.workout.create({ data: { userId, programAssignmentId: assignment.id, source: 'PROGRAM', status: 'DRAFT', scheduledFor: new Date(), title: day.title, estimatedDurationMinutes: day.estimatedDurationMinutes } });
      await this.snapshotDay(tx, workout.id, day);
      await this.audit(tx, userId, 'WORKOUT_CREATED', workout.id, { programId, dayId });
      return { id: workout.id, status: workout.status, title: workout.title, source: workout.source, version: workout.version, deepLink: `/workouts/${workout.id}` };
    }, 201);
  }

  async assignRecommended(userId: string, program: any, source: 'ONBOARDING' | 'ADMIN' | 'USER', tx: Prisma.TransactionClient) {
    await this.programRepository.archiveAssignments(userId);
    const assignment = await this.programRepository.upsertAssignment({ user: { connect: { id: userId } }, program: { connect: { id: program.id } }, source });
    await tx.auditLog.create({ data: { actorUserId: userId, targetUserId: userId, action: 'program.auto_assigned', entityType: 'PROGRAM', entityId: program.id, metadata: { assignmentId: assignment.id } } });
    this.metrics.event('program.auto_assigned', { userId, programId: program.id });
    return assignment;
  }

  private async snapshotDay(tx: Prisma.TransactionClient, workoutId: string, day: any) {
    for (const item of day.exercises) {
      const exercise = await tx.workoutExercise.create({ data: { workoutId, position: item.position, title: item.exercise.title, muscleGroup: item.exercise.muscleGroup, equipment: item.exercise.equipment, techniqueUrl: item.exercise.techniqueUrl, catalogExerciseId: item.exerciseId } });
      const planned = Array.isArray(item.plannedSets) ? item.plannedSets : [];
      const sets = item.sets?.length ? item.sets : planned;
      const fallback = sets.length ? sets : [{ plannedRepsMin: item.plannedRepsMin, plannedRepsMax: item.plannedRepsMax, plannedWeightKg: item.plannedWeightKg, restSeconds: item.restSeconds, setType: 'WORKING' }];
      for (const [index, set] of fallback.entries()) {
        await tx.workoutSet.create({ data: { exerciseId: exercise.id, position: index + 1, setType: set.setType || 'WORKING', plannedReps: set.plannedRepsMax ?? set.plannedRepsMin ?? set.reps ?? item.plannedRepsMax, plannedWeightKg: set.plannedWeightKg ?? set.weightKg ?? item.plannedWeightKg, restSeconds: set.restSeconds ?? item.restSeconds ?? 0 } });
      }
    }
  }

  private async requireOwnedDraft(userId: string, programId: string, version: number) {
    const program = await this.load(programId);
    if (program.ownerId !== userId || program.type !== 'USER_CUSTOM') {
      this.metrics.event('security.program.unauthorized_attempt', { userId, programId });
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only own custom programs can be edited' });
    }
    if (program.status === 'ARCHIVED' || program.status === 'COMPLETED') throw new ConflictException({ code: 'PROGRAM_STRUCTURE_INVALID', message: 'Archived programs cannot be edited' });
    if (program.version !== version) {
      this.metrics.increment('program_version_conflict_total');
      this.metrics.event('program.version_conflict', { userId, programId });
      throw new ConflictException({ code: 'PROGRAM_VERSION_CONFLICT', message: 'Program version is stale', details: [{ version: program.version }] });
    }
    return program;
  }

  private assertReadable(userId: string, program: any, plan: string, assignment: any) {
    if (program.type === 'USER_CUSTOM' && program.ownerId !== userId) {
      this.metrics.event('security.program.unauthorized_attempt', { userId, programId: program.id });
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Cannot access another user program' });
    }
    if (program.type === 'SYSTEM' && program.status !== 'PUBLISHED' && !assignment) throw new NotFoundException({ code: 'PROGRAM_NOT_FOUND', message: 'Program was not found' });
    if (program.isProOnly && plan !== 'PRO') throw new ForbiddenException({ code: 'PRO_FEATURE_REQUIRED', message: 'Pro subscription is required' });
  }

  private assertReorder(rows: Array<{ id: string }>, items: Array<{ id: string; orderIndex: number }>) {
    const ids = new Set(rows.map((row) => row.id));
    if (items.length !== rows.length || items.some((item) => !ids.has(item.id))) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Reorder payload must include every item exactly once' });
    const indexes = items.map((item) => item.orderIndex).sort((a, b) => a - b);
    if (indexes.some((value, index) => value !== index + 1)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'orderIndex values must be a contiguous sequence starting at 1' });
  }

  private async bump(programId: string, version: number) {
    await this.programRepository.update(programId, {}, version);
  }

  private async load(programId: string): Promise<any> {
    const program = await this.programRepository.findById(programId);
    if (!program) throw new NotFoundException({ code: 'PROGRAM_NOT_FOUND', message: 'Program was not found' });
    return program;
  }

  private summary(program: any, plan: string) {
    return { id: program.id, title: program.title, description: program.description, type: program.type, status: program.status,       goal: program.goal || this.asList(program.goals)[0], level: program.level || this.asList(program.levels)[0], location: program.location || this.asList(program.locations)[0], durationWeeks: program.durationWeeks, workoutsPerWeek: program.workoutsPerWeek, estimatedWorkoutDurationMinutes: program.estimatedWorkoutDurationMinutes || program.durationMinutes, requiredEquipment: this.asList(program.requiredEquipment), isProOnly: program.isProOnly, available: !program.isProOnly || plan === 'PRO' };
  }

  private detail(program: any, ctx: { plan: string; isActive: boolean; assignment?: any }) {
    const days = (program.workouts || []).map((day: any) => this.serializeDay(day, day.exercises || []));
    return {
      ...this.summary(program, ctx.plan),
      version: program.version,
      coverUrl: program.coverUrl,
      isActive: ctx.isActive,
      availableActions: this.actions(program, ctx),
      days,
    };
  }

  private serializeDay(day: any, exercises: any[]) {
    return {
      id: day.id,
      orderIndex: day.position,
      title: day.title,
      description: day.description,
      focus: day.focus,
      scheduledWeekday: day.scheduledWeekday,
      estimatedDurationMinutes: day.estimatedDurationMinutes,
      isRestDay: day.isRestDay,
      exercises: exercises.map((item) => ({
        id: item.id,
        exerciseId: item.exerciseId,
        title: item.exercise?.title,
        orderIndex: item.position,
        plannedSets: item.plannedSetsCount,
        plannedRepsMin: item.plannedRepsMin,
        plannedRepsMax: item.plannedRepsMax,
        plannedWeightKg: item.plannedWeightKg,
        targetRpe: item.targetRpe,
        restSeconds: item.restSeconds,
        note: item.note,
        allowReplacement: item.allowReplacement,
        alternativeExerciseIds: this.asList(item.alternativeExerciseIds),
        isOptional: item.isOptional,
        sets: (item.sets || []).map((set: any) => ({ id: set.id, setNumber: set.setNumber, setType: set.setType, plannedWeightKg: set.plannedWeightKg, plannedRepsMin: set.plannedRepsMin, plannedRepsMax: set.plannedRepsMax, targetRpe: set.targetRpe, restSeconds: set.restSeconds })),
      })),
    };
  }

  private actions(program: any, ctx: { plan: string; isActive: boolean }) {
    const actions: string[] = [];
    if (program.type === 'USER_CUSTOM' && program.ownerId) actions.push('EDIT');
    if (['SYSTEM', 'TEMPLATE'].includes(program.type)) actions.push('COPY');
    if (!ctx.isActive && (program.type === 'USER_CUSTOM' || program.status === 'PUBLISHED')) actions.push('ACTIVATE', 'START');
    if (program.type === 'USER_CUSTOM' && program.status !== 'ARCHIVED') actions.push('ARCHIVE');
    if (ctx.isActive) actions.push('START');
    return [...new Set(actions)];
  }

  private asList(value: unknown) { return Array.isArray(value) ? value.map(String) : []; }

  private async audit(tx: Prisma.TransactionClient, userId: string, action: string, entityId: string, metadata: Record<string, unknown> = {}) {
    await tx.auditLog.create({ data: { actorUserId: userId, targetUserId: userId, action, entityType: 'PROGRAM', entityId, metadata: metadata as Prisma.InputJsonValue } });
  }

  private async idempotent(userId: string, key: string | undefined, payload: unknown, operation: (tx: Prisma.TransactionClient) => Promise<any>, status = 200) {
    if (!key) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key is required' });
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
      if (previous) {
        if (previous.requestHash !== hash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key was used with a different request' });
        return previous.responseBody;
      }
      const response = await operation(tx);
      await tx.idempotencyKey.create({ data: { userId, key, requestHash: hash, responseStatus: status, responseBody: response as any, expiresAt: new Date(Date.now() + 86_400_000) } });
      return response;
    });
  }
}
