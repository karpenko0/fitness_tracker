import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class ProgressionHistoryService {
  constructor(private readonly prisma: PrismaClient) {}

  async latest(userId: string, exerciseId: string, take = 2) {
    return this.prisma.exercisePerformance.findMany({ where: { userId, exerciseId }, orderBy: [{ performedAt: 'desc' }, { id: 'desc' }], take });
  }
}
