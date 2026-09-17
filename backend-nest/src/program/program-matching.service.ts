import { Injectable, Optional, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { overlappingContraindications } from './program.validation';

@Injectable()
export class ProgramMatchingService {
  constructor(private readonly prisma: PrismaClient, @Optional() private readonly config?: ConfigService) {}

  async recommend(data: Record<string, any>, client: PrismaClient | any = this.prisma) {
    const programs = await (client as PrismaClient).starterProgram.findMany({
      where: { status: 'PUBLISHED', active: true, type: { in: ['SYSTEM', 'AUTO_ASSIGNED', 'TEMPLATE'] as any } },
      include: { workouts: { include: { exercises: { include: { exercise: true } } } } },
    });
    const equipment = new Set<string>(Array.isArray(data.equipment) ? data.equipment : []);
    const userTags = Array.isArray(data.limitationTags) ? data.limitationTags : this.parseLimitationTags(data.limitations);
    const safe = programs.filter((program) => this.safe(program, userTags));
    const exact = safe.filter((program) => this.exact(program, data, equipment));
    const close = safe.filter((program) => this.close(program, data, equipment));
    const levelSafe = safe.filter((program) => this.levelMatch(program, data) && this.equipmentOk(program, equipment));
    const fallbackEnabled = this.config?.get<string>('ONBOARDING_FALLBACK_ENABLED', 'true') !== 'false';
    const selected = exact[0] || close.sort((a, b) => (this.duration(b) - this.duration(a)))[0] || levelSafe[0] || (fallbackEnabled ? safe.find((program) => program.isFallback) || await (client as PrismaClient).starterProgram.findFirst({ where: { status: 'PUBLISHED', active: true, isFallback: true } }) : null);
    if (!selected) throw new UnprocessableEntityException({ code: 'STARTER_PROGRAM_NOT_FOUND', message: 'No safe starter program is available' });
    const matchType = exact[0] ? 'exact' : close[0] ? 'nearest_duration' : levelSafe[0] ? 'level_safe' : 'fallback';
    return { program: selected, fallback: matchType === 'fallback', matchType };
  }

  parseLimitationTags(value: unknown) {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value !== 'string' || !value.trim()) return [];
    return value.split(/[,\n;]+/).map((item) => item.trim().toUpperCase().replace(/\s+/g, '_')).filter(Boolean);
  }

  private exact(program: any, data: any, equipment: Set<string>) {
    return this.goal(program) === data.fitnessGoal && this.lvl(program) === data.experienceLevel && this.loc(program) === data.trainingLocation
      && program.workoutsPerWeek === data.trainingFrequency && this.duration(program) === data.preferredWorkoutDuration && this.equipmentOk(program, equipment);
  }

  private close(program: any, data: any, equipment: Set<string>) {
    return this.goal(program) === data.fitnessGoal && this.lvl(program) === data.experienceLevel && this.loc(program) === data.trainingLocation
      && this.duration(program) <= data.preferredWorkoutDuration && this.equipmentOk(program, equipment);
  }

  private levelMatch(program: any, data: any) {
    return this.lvl(program) === data.experienceLevel && this.goal(program) === data.fitnessGoal;
  }

  private equipmentOk(program: any, equipment: Set<string>) {
    return this.list(program.requiredEquipment).every((item) => equipment.has(item));
  }

  private safe(program: any, userTags: unknown[]) {
    if (overlappingContraindications(program.contraindications, userTags).length) return false;
    for (const day of program.workouts || []) {
      for (const item of day.exercises || []) {
        if (overlappingContraindications(item.exercise?.contraindications, userTags).length) return false;
      }
    }
    return true;
  }

  private goal(program: any) { return program.goal || this.list(program.goals)[0]; }
  private lvl(program: any) { return program.level || this.list(program.levels)[0]; }
  private loc(program: any) { return program.location || this.list(program.locations)[0]; }
  private duration(program: any) { return program.estimatedWorkoutDurationMinutes || program.durationMinutes; }
  private list(value: unknown) { return Array.isArray(value) ? value.map(String) : []; }
}
