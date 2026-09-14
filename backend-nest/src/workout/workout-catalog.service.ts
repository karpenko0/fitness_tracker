import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class WorkoutCatalogService {
  constructor(private readonly prisma: PrismaClient) {}

  async exercises() { return { data: await this.prisma.exerciseCatalogItem.findMany({ where: { active: true }, orderBy: [{ muscleGroup: 'asc' }, { title: 'asc' }] }) }; }
  async templates(userId: string) { return { data: await this.prisma.workoutTemplate.findMany({ where: { OR: [{ userId }, { userId: null }] }, orderBy: { title: 'asc' } }) }; }
  async createTemplate(userId: string, body: any) { if (typeof body?.title !== 'string' || !body.title.trim() || !Array.isArray(body.exercises)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'title and exercises are required' }); const template = await this.prisma.workoutTemplate.create({ data: { userId, title: body.title.trim().slice(0, 255), exercises: body.exercises } }); await this.audit(userId, 'WORKOUT_TEMPLATE_CREATED', template.id); return { data: template }; }
  async createExercise(userId: string, body: any) { if (typeof body?.title !== 'string' || typeof body?.muscleGroup !== 'string') throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'title and muscleGroup are required' }); const exercise = await this.prisma.exerciseCatalogItem.create({ data: { title: body.title.trim().slice(0, 255), muscleGroup: body.muscleGroup.trim().slice(0, 128), movementType: body.movementType ?? null, equipment: body.equipment ?? null, difficulty: body.difficulty ?? null, techniqueUrl: body.techniqueUrl ?? null } }); await this.audit(userId, 'EXERCISE_CATALOG_CREATED', exercise.id); return { data: exercise }; }
  private async audit(userId: string, action: string, entityId: string) { await this.prisma.auditLog.create({ data: { actorUserId: userId, targetUserId: userId, action, entityType: 'WORKOUT_CATALOG', entityId } }); }
}
