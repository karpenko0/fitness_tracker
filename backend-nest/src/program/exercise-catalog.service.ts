import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { EntitlementService } from './entitlement.service';
import { ProgramMetricsService } from './program-metrics.service';
import { assertContraindications, assertEquipment, assertMuscles, decodeCursor, encodeCursor, overlappingContraindications } from './program.validation';
import { CreateCustomExerciseDto, ExerciseQueryDto } from './dto/program.dto';

@Injectable()
export class ExerciseCatalogService {
  constructor(private readonly prisma: PrismaClient, private readonly entitlements: EntitlementService, private readonly metrics: ProgramMetricsService) {}

  async list(userId: string, query: ExerciseQueryDto) {
    const started = Date.now();
    const entitlement = await this.entitlements.get(userId);
    const limit = query.limit ?? 20;
    const cursor = decodeCursor(query.cursor);
    const q = query.q?.trim();
    const primaryMuscle = query.primaryMuscle ? assertMuscles([query.primaryMuscle], 'primaryMuscle')[0] : undefined;
    const equipment = query.equipment ? assertEquipment(query.equipment, 'equipment') : [];
    const excluded = query.excludeContraindications ? assertContraindications(query.excludeContraindications.split(',')) : [];
    const cacheKey = `exercises:${entitlement.plan}:${JSON.stringify(query)}`;
    const cached = this.metrics.getCached<any>(cacheKey);
    if (cached) return cached;
    const where: Prisma.ExerciseCatalogItemWhereInput = {
      active: true,
      AND: [
        { OR: [{ isSystem: true, ...(entitlement.plan === 'FREE' ? { isProOnly: false } : {}) }, { ownerId: userId, isSystem: false }] },
        q ? { title: { contains: q, mode: 'insensitive' } } : {},
        query.difficulty ? { difficulty: query.difficulty } : {},
        cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {},
      ],
    };
    const rows = await this.prisma.exerciseCatalogItem.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    const filtered = rows.filter((row) => {
      const muscles = this.asList(row.primaryMuscles);
      const gear = this.asList(row.equipmentList).concat(row.equipment ? [row.equipment] : []);
      const tags = this.asList(row.contraindications);
      if (primaryMuscle && !muscles.includes(primaryMuscle)) return false;
      if (equipment.length && !equipment.every((item) => gear.includes(item)) && !gear.some((item) => equipment.includes(item))) return false;
      if (excluded.some((tag) => tags.includes(tag))) return false;
      return true;
    });
    const page = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const result = { items: page.map((row) => this.summary(row)), nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id) : null, hasMore };
    this.metrics.setCached(cacheKey, result);
    this.metrics.increment('exercise_catalog_requests_total', { filter_type: q ? 'search' : primaryMuscle ? 'muscle' : equipment.length ? 'equipment' : 'all' });
    this.metrics.event('exercise.catalog.requested', { userId, durationMs: Date.now() - started });
    return result;
  }

  async get(userId: string, exerciseId: string) {
    const exercise = await this.prisma.exerciseCatalogItem.findUnique({ where: { id: exerciseId }, include: { sourceAlternatives: { include: { alternative: true } }, mediaItems: { orderBy: { position: 'asc' } } } });
    if (!exercise) throw new NotFoundException({ code: 'EXERCISE_NOT_FOUND', message: 'Exercise was not found' });
    const entitlement = await this.entitlements.get(userId);
    if (exercise.isProOnly && entitlement.plan !== 'PRO') throw new ForbiddenException({ code: 'PRO_FEATURE_REQUIRED', message: 'Pro subscription is required' });
    if (!exercise.active || (!exercise.isSystem && exercise.ownerId !== userId)) throw new UnprocessableEntityException({ code: 'EXERCISE_NOT_AVAILABLE', message: 'Exercise is not available' });
    const profile = await this.prisma.userProfile.findUnique({ where: { userId }, select: { limitationTags: true } });
    const overlaps = overlappingContraindications(exercise.contraindications, profile?.limitationTags);
    const linked = (exercise.sourceAlternatives || []).map((item) => ({ id: item.alternative.id, title: item.alternative.title }));
    const extras = await this.alternativesFromJson(exercise.alternativeExerciseIds);
    const alternatives = [...linked, ...extras];
    return {
      ...this.detail(exercise),
      warning: overlaps.length ? { code: 'EXERCISE_LIMITATION_WARNING', message: 'This exercise may be uncomfortable with your selected limitations. This is general information and not a medical diagnosis or prescription.', tags: overlaps } : null,
      alternatives: alternatives.filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).map((item) => ({ id: item.id, title: item.title })),
    };
  }

  async createCustom(userId: string, dto: CreateCustomExerciseDto, key?: string) {
    return this.idempotent(userId, key, dto, async (tx) => {
      await this.entitlements.assertCanCreateCustomExercise(userId, tx);
      const primaryMuscles = assertMuscles(dto.primaryMuscles);
      const secondaryMuscles = dto.secondaryMuscles ? assertMuscles(dto.secondaryMuscles, 'secondaryMuscles') : [];
      const equipment = assertEquipment(dto.equipment || ['BODYWEIGHT']);
      const exercise = await tx.exerciseCatalogItem.create({
        data: {
          ownerId: userId,
          isSystem: false,
          title: dto.title.trim(),
          description: dto.description || '',
          muscleGroup: primaryMuscles[0],
          primaryMuscles,
          secondaryMuscles,
          equipment: equipment[0] || null,
          equipmentList: equipment,
          difficulty: dto.difficulty || 'BEGINNER',
          exerciseType: (dto.exerciseType as any) || 'STRENGTH',
          slug: `user-${userId.slice(0, 8)}-${Date.now()}`,
        },
      });
      await this.syncRelations(tx, exercise.id, primaryMuscles, secondaryMuscles, equipment, []);
      await tx.auditLog.create({ data: { actorUserId: userId, targetUserId: userId, action: 'CUSTOM_EXERCISE_CREATED', entityType: 'EXERCISE', entityId: exercise.id } });
      return this.detail(exercise);
    }, 201);
  }

  async assertUsable(tx: Prisma.TransactionClient, userId: string, exerciseId: string) {
    const exercise = await tx.exerciseCatalogItem.findUnique({ where: { id: exerciseId } });
    if (!exercise) throw new NotFoundException({ code: 'EXERCISE_NOT_FOUND', message: 'Exercise was not found' });
    if (!exercise.active || (!exercise.isSystem && exercise.ownerId !== userId)) throw new UnprocessableEntityException({ code: 'EXERCISE_NOT_AVAILABLE', message: 'Exercise is not available' });
    const entitlement = await this.entitlements.get(userId, tx);
    if (exercise.isProOnly && entitlement.plan !== 'PRO') throw new ForbiddenException({ code: 'PRO_FEATURE_REQUIRED', message: 'Pro subscription is required' });
    return exercise;
  }

  private async alternativesFromJson(ids: unknown) {
    const list = Array.isArray(ids) ? ids.map(String) : [];
    if (!list.length) return [];
    return this.prisma.exerciseCatalogItem.findMany({ where: { id: { in: list }, active: true }, select: { id: true, title: true } });
  }

  private async syncRelations(tx: Prisma.TransactionClient, exerciseId: string, primary: string[], secondary: string[], equipment: string[], tags: string[]) {
    await tx.exerciseMuscle.deleteMany({ where: { exerciseId } }).catch(() => undefined);
    for (const muscle of primary) await tx.exerciseMuscle.create({ data: { exerciseId, muscle, isPrimary: true } }).catch(() => undefined);
    for (const muscle of secondary) await tx.exerciseMuscle.create({ data: { exerciseId, muscle, isPrimary: false } }).catch(() => undefined);
    for (const item of equipment) await tx.exerciseEquipment.create({ data: { exerciseId, equipment: item } }).catch(() => undefined);
    for (const tag of tags) await tx.exerciseContraindication.create({ data: { exerciseId, tag } }).catch(() => undefined);
  }

  private summary(row: any) {
    return { id: row.id, title: row.title, exerciseType: row.exerciseType, difficulty: row.difficulty, primaryMuscles: this.asList(row.primaryMuscles), equipment: this.asList(row.equipmentList), isProOnly: row.isProOnly };
  }

  private detail(row: any) {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      exerciseType: row.exerciseType,
      difficulty: row.difficulty,
      primaryMuscles: this.asList(row.primaryMuscles),
      secondaryMuscles: this.asList(row.secondaryMuscles),
      equipment: this.asList(row.equipmentList).concat(row.equipment && !this.asList(row.equipmentList).includes(row.equipment) ? [row.equipment] : []),
      instructions: Array.isArray(row.instructions) ? row.instructions : [],
      safetyNotes: row.safetyNotes,
      contraindications: this.asList(row.contraindications),
      media: Array.isArray(row.mediaItems) && row.mediaItems.length ? row.mediaItems.map((item: any) => ({ type: item.type, url: item.url })) : this.asList(row.media),
      isProOnly: row.isProOnly,
    };
  }

  private asList(value: unknown) { return Array.isArray(value) ? value.map(String) : []; }

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
