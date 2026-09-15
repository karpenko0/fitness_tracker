import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ALGORITHM_VERSION, FORMULA_VERSION } from './progression.calculations';

@Injectable()
export class ProgressionConfigService {
  constructor(private readonly prisma: PrismaClient) {}
  async get() { return this.ensure(); }
  async update(actorUserId: string, patch: { increasePercent?: number; decreasePercent?: number; maxIncreasePercent?: number; active?: boolean }) {
    const config = await this.ensure();
    const updated = await this.prisma.progressionAlgorithmConfig.update({ where: { id: config.id }, data: patch });
    await this.prisma.auditLog.create({ data: { actorUserId, action: 'PROGRESSION_ALGORITHM_CONFIG_UPDATED', entityType: 'PROGRESSION_ALGORITHM_CONFIG', entityId: updated.id, metadata: { algorithmVersion: updated.algorithmVersion, changed: Object.keys(patch) } } });
    return updated;
  }
  private async ensure() {
    return this.prisma.progressionAlgorithmConfig.upsert({ where: { algorithmVersion: ALGORITHM_VERSION }, create: { algorithmVersion: ALGORITHM_VERSION, formulaVersion: FORMULA_VERSION }, update: {} });
  }
}
