import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class EntitlementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUserId(userId: string): Promise<any | null> {
    return this.prisma.subscriptionEntitlement.findUnique({ where: { userId } });
  }

  async create(data: Prisma.SubscriptionEntitlementCreateInput): Promise<any> {
    return this.prisma.subscriptionEntitlement.create({ data });
  }

  async update(userId: string, data: Prisma.SubscriptionEntitlementUpdateInput): Promise<any> {
    return this.prisma.subscriptionEntitlement.update({ where: { userId }, data });
  }

  async upsert(userId: string, data: Prisma.SubscriptionEntitlementCreateInput): Promise<any> {
    return this.prisma.subscriptionEntitlement.upsert({ where: { userId }, create: data, update: data });
  }

  async delete(userId: string): Promise<void> {
    await this.prisma.subscriptionEntitlement.delete({ where: { userId } });
  }

  async countActiveCustomPrograms(userId: string): Promise<number> {
    return this.prisma.starterProgram.count({ where: { ownerId: userId, type: 'USER_CUSTOM', status: 'ACTIVE' } });
  }

  async countDraftCustomPrograms(userId: string): Promise<number> {
    return this.prisma.starterProgram.count({ where: { ownerId: userId, type: 'USER_CUSTOM', status: 'DRAFT' } });
  }

  async countCustomExercises(userId: string): Promise<number> {
    return this.prisma.exerciseCatalogItem.count({ where: { ownerId: userId, isSystem: false } });
  }
}
