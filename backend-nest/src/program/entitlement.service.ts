import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { FREE_LIMITS, PRO_LIMITS } from './program.constants';

@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(userId: string, client: PrismaClient | Prisma.TransactionClient = this.prisma) {
    const table = (client as any).subscriptionEntitlement;
    const row = table?.findUnique ? await table.findUnique({ where: { userId } }) : null;
    if (row) return row;
    return { userId, plan: 'FREE' as const, ...FREE_LIMITS, extendedStats: false };
  }

  limits(plan: string) {
    return plan === 'PRO' ? { plan: 'PRO' as const, ...PRO_LIMITS, extendedStats: true } : { plan: 'FREE' as const, ...FREE_LIMITS, extendedStats: false };
  }

  async assertPro(userId: string, client?: PrismaClient | Prisma.TransactionClient) {
    const entitlement = await this.get(userId, client);
    if (entitlement.plan !== 'PRO') throw new ForbiddenException({ code: 'PRO_FEATURE_REQUIRED', message: 'Pro subscription is required' });
    return entitlement;
  }

  async assertCanCreateCustomProgram(userId: string, client: PrismaClient | Prisma.TransactionClient = this.prisma) {
    const entitlement = await this.get(userId, client);
    if (entitlement.plan === 'PRO') return entitlement;
    const drafts = await (client as PrismaClient).starterProgram.count({ where: { ownerId: userId, type: 'USER_CUSTOM' as any, status: 'DRAFT' } });
    if (drafts >= entitlement.maxDraftCustomPrograms) {
      throw new ForbiddenException({ code: 'PLAN_LIMIT_EXCEEDED', message: 'Free draft program limit exceeded', details: [{ field: 'drafts', limit: entitlement.maxDraftCustomPrograms }] });
    }
    return entitlement;
  }

  async assertCanActivateCustomProgram(userId: string, client: PrismaClient | Prisma.TransactionClient = this.prisma) {
    const entitlement = await this.get(userId, client);
    if (entitlement.plan === 'PRO') return entitlement;
    const active = await (client as PrismaClient).starterProgram.count({ where: { ownerId: userId, type: 'USER_CUSTOM' as any, status: 'ACTIVE' } });
    if (active >= entitlement.maxActiveCustomPrograms) {
      throw new ForbiddenException({ code: 'PLAN_LIMIT_EXCEEDED', message: 'Free active custom program limit exceeded', details: [{ field: 'activePrograms', limit: entitlement.maxActiveCustomPrograms }] });
    }
    return entitlement;
  }

  async assertCanCreateCustomExercise(userId: string, client: PrismaClient | Prisma.TransactionClient = this.prisma) {
    const entitlement = await this.get(userId, client);
    if (entitlement.plan === 'PRO') return entitlement;
    const count = await (client as PrismaClient).exerciseCatalogItem.count({ where: { ownerId: userId, isSystem: false } });
    if (count >= entitlement.maxCustomExercises) {
      throw new ForbiddenException({ code: 'PLAN_LIMIT_EXCEEDED', message: 'Free custom exercise limit exceeded', details: [{ field: 'customExercises', limit: entitlement.maxCustomExercises }] });
    }
    return entitlement;
  }
}
