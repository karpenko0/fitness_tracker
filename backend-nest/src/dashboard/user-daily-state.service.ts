import { ConflictException, Injectable } from '@nestjs/common';
import { DashboardDayState, DashboardPrimaryActionType, PrismaClient } from '@prisma/client';

@Injectable()
export class UserDailyStateService {
  constructor(private readonly prisma: PrismaClient) {}
  async save(userId: string, localDate: string, timezone: string, state: DashboardDayState, action: DashboardPrimaryActionType, ids: { activeWorkoutId?: string; plannedWorkoutId?: string; activeProgramId?: string }, counts: { completed: number; planned: number }, expectedVersion?: number) {
    const now = new Date();
    const key = { userId, localDate: new Date(`${localDate}T00:00:00Z`), timezone };
    const values = { state, primaryActionType: action, ...ids, completedWorkoutCount: counts.completed, plannedWorkoutCount: counts.planned, calculatedAt: now, expiresAt: new Date(now.getTime() + 300000) };
    if (expectedVersion === undefined) return this.prisma.userDailyState.upsert({ where: { userId_localDate_timezone: key }, create: { ...key, ...values, sourceVersion: 1n }, update: { ...values, version: { increment: 1 } } });
    const result = await this.prisma.userDailyState.updateMany({ where: { ...key, version: expectedVersion }, data: { ...values, version: { increment: 1 } } });
    if (result.count !== 1) throw new ConflictException({ code: 'USER_DAILY_STATE_CONFLICT', message: 'Daily state was changed concurrently' });
    return this.prisma.userDailyState.findUniqueOrThrow({ where: { userId_localDate_timezone: key } });
  }
}
