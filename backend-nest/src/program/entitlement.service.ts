import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { FREE_LIMITS, PRO_LIMITS } from './program.constants';
import { entitlementRequired, resolveAccess } from '../subscription/access';
import { Entitlement } from '../subscription/subscription.catalog';

@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(userId: string, client: PrismaClient | Prisma.TransactionClient = this.prisma) {
    // Источник истины — подписка (SPEC-010); лимиты берутся из единого каталога.
    const { tier } = await resolveAccess(client, userId);
    return { userId, ...this.limits(tier) };
  }

  limits(plan: string) {
    return plan === 'PRO' || plan === 'TRAINER_PRO' ? { plan: 'PRO' as const, ...PRO_LIMITS, extendedStats: true } : { plan: 'FREE' as const, ...FREE_LIMITS, extendedStats: false };
  }

  async assertPro(userId: string, client?: PrismaClient | Prisma.TransactionClient) {
    const entitlement = await this.get(userId, client);
    if (entitlement.plan !== 'PRO') throw await this.proRequired(userId, 'PRO_CONTENT', client);
    return entitlement;
  }

  /** 403 ENTITLEMENT_REQUIRED с paywallContext (замена PRO_FEATURE_REQUIRED). */
  async proRequired(userId: string, entitlement: Entitlement = 'PRO_CONTENT', client: PrismaClient | Prisma.TransactionClient = this.prisma) {
    return entitlementRequired(client, userId, entitlement);
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
