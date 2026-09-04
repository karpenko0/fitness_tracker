import { Injectable, Optional, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class StarterProgramRecommendationService {
  constructor(private readonly prisma: PrismaClient, @Optional() private readonly config?: ConfigService) {}

  async recommend(data: Record<string, any>, client: PrismaClient = this.prisma) {
    const programs = await client.starterProgram.findMany({ where: { status: 'PUBLISHED', active: true } });
    const equipment = new Set<string>(Array.isArray(data.equipment) ? data.equipment : []);
    const compatible = programs.filter((p: any) => this.compatible(p, data, equipment));
    const sorted = compatible.sort((a: any, b: any) => this.score(b, data) - this.score(a, data));
    const fallbackEnabled = this.config?.get<string>('ONBOARDING_FALLBACK_ENABLED', 'true') !== 'false';
    const selected = sorted[0] || (fallbackEnabled ? await client.starterProgram.findFirst({ where: { status: 'PUBLISHED', active: true, isFallback: true } }) : null);
    if (!selected) throw new UnprocessableEntityException({ code: 'STARTER_PROGRAM_NOT_FOUND', message: 'No safe starter program is available' });
    return { program: selected, fallback: !sorted.length };
  }

  private compatible(program: any, data: any, equipment: Set<string>) {
    const list = (value: unknown) => Array.isArray(value) ? value : [];
    return list(program.goals).includes(data.fitnessGoal) && list(program.levels).includes(data.experienceLevel) &&
      list(program.locations).includes(data.trainingLocation) && program.workoutsPerWeek <= data.trainingFrequency &&
      program.durationMinutes <= data.preferredWorkoutDuration && list(program.requiredEquipment).every((item: string) => equipment.has(item));
  }
  private score(program: any, data: any) {
    return (program.workoutsPerWeek === data.trainingFrequency ? 16 : 0) + (program.durationMinutes === data.preferredWorkoutDuration ? 8 : 0) +
      (program.isFallback ? 0 : 1);
  }
}
