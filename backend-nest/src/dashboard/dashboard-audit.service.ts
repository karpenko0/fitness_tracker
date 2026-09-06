import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class DashboardAuditService {
  constructor(private readonly prisma: PrismaClient) {}
  async adminViewed(actorUserId: string, targetUserId: string, requestId: string, reason: string, ipHash?: string) {
    await this.prisma.auditLog.create({ data: { actorUserId, targetUserId, action: 'ADMIN_DASHBOARD_VIEW', entityType: 'USER_DASHBOARD', entityId: targetUserId, requestId, ipHash, metadata: { reason } } });
  }
}
