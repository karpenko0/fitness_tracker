import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class ExerciseCatalogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findMany(userId: string, query: any): Promise<any[]> {
    const { q, primaryMuscle, equipment, difficulty, excludeContraindications, cursor, limit = 20 } = query;
    const entitlement = await this.prisma.subscriptionEntitlement.findUnique({ where: { userId } });
    const plan = entitlement?.plan || 'FREE';
    const where: any = {
      active: true,
      AND: [
        { OR: [{ isSystem: true, ...(plan === 'FREE' ? { isProOnly: false } : {}) }, { ownerId: userId, isSystem: false }] },
        q ? { title: { contains: q, mode: 'insensitive' } } : {},
        primaryMuscle ? { primaryMuscles: { has: primaryMuscle } } : {},
        difficulty ? { difficulty } : {},
        excludeContraindications ? { contraindications: { none: { has: excludeContraindications } } } : {},
        cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {},
      ],
    };
    if (equipment) {
      const eq = equipment.split(',').map((e: string) => e.trim());
      where.equipmentList = { hasSome: eq };
    }
    return this.prisma.exerciseCatalogItem.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, include: { sourceAlternatives: { include: { alternative: true } }, mediaItems: { orderBy: { position: 'asc' } } } });
  }

  async findById(exerciseId: string, userId: string): Promise<any | null> {
    const exercise = await this.prisma.exerciseCatalogItem.findUnique({ where: { id: exerciseId }, include: { sourceAlternatives: { include: { alternative: true } }, mediaItems: { orderBy: { position: 'asc' } } } });
    if (!exercise) return null;
    const entitlement = await this.prisma.subscriptionEntitlement.findUnique({ where: { userId } });
    const plan = entitlement?.plan || 'FREE';
    if (exercise.isProOnly && plan !== 'PRO') return null;
    if (!exercise.active || (!exercise.isSystem && exercise.ownerId !== userId)) return null;
    return exercise;
  }

  async findBySlug(slug: string): Promise<any | null> {
    return this.prisma.exerciseCatalogItem.findUnique({ where: { slug } });
  }

  async create(data: Prisma.ExerciseCatalogItemCreateInput): Promise<any> {
    return this.prisma.exerciseCatalogItem.create({ data });
  }

  async update(exerciseId: string, data: Prisma.ExerciseCatalogItemUpdateInput): Promise<any> {
    return this.prisma.exerciseCatalogItem.update({ where: { id: exerciseId }, data });
  }

  async delete(exerciseId: string): Promise<void> {
    await this.prisma.exerciseCatalogItem.delete({ where: { id: exerciseId } });
  }

  async count(userId: string, filters: any): Promise<number> {
    const where: Prisma.ExerciseCatalogItemWhereInput = { ownerId: userId, isSystem: false, ...filters };
    return this.prisma.exerciseCatalogItem.count({ where });
  }

  async findAlternatives(exerciseId: string): Promise<any[]> {
    const alternatives = await this.prisma.exerciseAlternative.findMany({ where: { exerciseId }, include: { alternative: true } });
    return alternatives.map((a) => a.alternative);
  }

  async findMuscles(exerciseId: string): Promise<any[]> {
    return this.prisma.exerciseMuscle.findMany({ where: { exerciseId } });
  }

  async findEquipment(exerciseId: string): Promise<any[]> {
    return this.prisma.exerciseEquipment.findMany({ where: { exerciseId } });
  }

  async findContraindications(exerciseId: string): Promise<any[]> {
    return this.prisma.exerciseContraindication.findMany({ where: { exerciseId } });
  }

  async findMedia(exerciseId: string): Promise<any[]> {
    return this.prisma.exerciseMedia.findMany({ where: { exerciseId }, orderBy: { position: 'asc' } });
  }

  async createMuscle(data: Prisma.ExerciseMuscleCreateInput): Promise<any> {
    return this.prisma.exerciseMuscle.create({ data });
  }

  async createEquipment(data: Prisma.ExerciseEquipmentCreateInput): Promise<any> {
    return this.prisma.exerciseEquipment.create({ data });
  }

  async createAlternative(data: Prisma.ExerciseAlternativeCreateInput): Promise<any> {
    return this.prisma.exerciseAlternative.create({ data });
  }

  async createMedia(data: Prisma.ExerciseMediaCreateInput): Promise<any> {
    return this.prisma.exerciseMedia.create({ data });
  }

  async createContraindication(data: Prisma.ExerciseContraindicationCreateInput): Promise<any> {
    return this.prisma.exerciseContraindication.create({ data });
  }

  async deleteRelations(exerciseId: string): Promise<void> {
    await this.prisma.exerciseMuscle.deleteMany({ where: { exerciseId } });
    await this.prisma.exerciseEquipment.deleteMany({ where: { exerciseId } });
    await this.prisma.exerciseAlternative.deleteMany({ where: { exerciseId } });
    await this.prisma.exerciseMedia.deleteMany({ where: { exerciseId } });
    await this.prisma.exerciseContraindication.deleteMany({ where: { exerciseId } });
  }
}
