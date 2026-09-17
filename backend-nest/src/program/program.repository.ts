import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, ProgramStatus } from '@prisma/client';

@Injectable()
export class ProgramRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findMany(userId: string, query: any): Promise<any[]> {
    const { goal, level, location, equipment, isProOnly, cursor, limit = 20 } = query;
    const where: Prisma.StarterProgramWhereInput = {
      status: 'PUBLISHED',
      active: true,
      type: { in: ['SYSTEM', 'TEMPLATE'] },
      ...(isProOnly != null ? { isProOnly } : {}),
      ...(goal ? { OR: [{ goal }, { goals: { array_contains: goal } }] } : {}),
      ...(level ? { OR: [{ level }, { levels: { array_contains: level } }] } : {}),
      ...(location ? { OR: [{ location }, { locations: { array_contains: location } }] } : {}),
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    };
    if (equipment) {
      const eq = equipment.split(',').map((e: string) => e.trim());
      (where as any).requiredEquipment = { hasSome: eq };
    }
    return this.prisma.starterProgram.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
  }

  async findById(programId: string): Promise<any | null> {
    return this.prisma.starterProgram.findUnique({ where: { id: programId }, include: { workouts: { orderBy: { position: 'asc' }, include: { exercises: { orderBy: { position: 'asc' }, include: { exercise: true, sets: { orderBy: { setNumber: 'asc' } } } } } } } });
  }

  async findActiveByUserId(userId: string): Promise<any | null> {
    const assignment = await this.prisma.userProgramAssignment.findFirst({ where: { userId, status: 'ACTIVE' }, include: { program: { include: { workouts: { orderBy: { position: 'asc' }, include: { exercises: { orderBy: { position: 'asc' }, include: { exercise: true, sets: { orderBy: { setNumber: 'asc' } } } } } } } } } });
    return assignment?.program || null;
  }

  async create(data: Prisma.StarterProgramCreateInput): Promise<any> {
    return this.prisma.starterProgram.create({ data });
  }

  async update(programId: string, data: Prisma.StarterProgramUpdateInput, version: number): Promise<any> {
    return this.prisma.starterProgram.update({ where: { id: programId, version }, data: { ...data, version: { increment: 1 } } });
  }

  async updateStatus(programId: string, status: ProgramStatus): Promise<any> {
    return this.prisma.starterProgram.update({ where: { id: programId }, data: { status } });
  }

  async count(userId: string, filters: any): Promise<number> {
    const where: Prisma.StarterProgramWhereInput = { ownerId: userId, type: 'USER_CUSTOM', ...filters };
    return this.prisma.starterProgram.count({ where });
  }

  async findDays(programId: string): Promise<any[]> {
    return this.prisma.programWorkout.findMany({ where: { programId }, orderBy: { position: 'asc' } });
  }

  async findExercises(programId: string, dayId: string): Promise<any[]> {
    return this.prisma.programWorkoutExercise.findMany({ where: { programWorkoutId: dayId }, orderBy: { position: 'asc' }, include: { exercise: true, sets: { orderBy: { setNumber: 'asc' } } } });
  }

  async findWorkoutExercise(programId: string, dayId: string, exerciseId: string): Promise<any | null> {
    return this.prisma.programWorkoutExercise.findFirst({ where: { programWorkoutId: dayId, exerciseId } });
  }

  async createDay(data: Prisma.ProgramWorkoutCreateInput): Promise<any> {
    return this.prisma.programWorkout.create({ data });
  }

  async createExercise(data: Prisma.ProgramWorkoutExerciseCreateInput): Promise<any> {
    return this.prisma.programWorkoutExercise.create({ data });
  }

  async updateDayPosition(dayId: string, position: number): Promise<any> {
    return this.prisma.programWorkout.update({ where: { id: dayId }, data: { position } });
  }

  async updateExercisePosition(exerciseId: string, position: number): Promise<any> {
    return this.prisma.programWorkoutExercise.update({ where: { id: exerciseId }, data: { position } });
  }

  async deleteDay(dayId: string): Promise<void> {
    await this.prisma.programWorkout.delete({ where: { id: dayId } });
  }

  async deleteExercise(exerciseId: string): Promise<void> {
    await this.prisma.programWorkoutExercise.delete({ where: { id: exerciseId } });
  }

  async findSets(programExerciseId: string): Promise<any[]> {
    return this.prisma.programExerciseSet.findMany({ where: { programExerciseId }, orderBy: { setNumber: 'asc' } });
  }

  async createSet(data: Prisma.ProgramExerciseSetCreateInput): Promise<any> {
    return this.prisma.programExerciseSet.create({ data });
  }

  async findUserAssignment(userId: string, programId: string): Promise<any | null> {
    return this.prisma.userProgramAssignment.findFirst({ where: { userId, programId } });
  }

  async findActiveAssignment(userId: string): Promise<any | null> {
    return this.prisma.userProgramAssignment.findFirst({ where: { userId, status: 'ACTIVE' } });
  }

  async upsertAssignment(data: Prisma.UserProgramAssignmentCreateInput): Promise<any> {
    return this.prisma.userProgramAssignment.upsert({ where: { userId_programId_source: { userId: (data as any).user, programId: (data as any).program, source: data.source } }, create: data, update: { status: 'ACTIVE', startedAt: new Date() } });
  }

  async archiveAssignments(userId: string): Promise<void> {
    await this.prisma.userProgramAssignment.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'ARCHIVED' } });
  }

  async countUserPrograms(userId: string, status: ProgramStatus): Promise<number> {
    return this.prisma.starterProgram.count({ where: { ownerId: userId, type: 'USER_CUSTOM', status } });
  }

  async countUserExercises(userId: string): Promise<number> {
    return this.prisma.exerciseCatalogItem.count({ where: { ownerId: userId, isSystem: false } });
  }
}
