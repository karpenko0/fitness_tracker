import { Injectable } from '@nestjs/common';
import { DashboardDayState, DashboardPrimaryActionType, PrismaClient } from '@prisma/client';

@Injectable()
export class UserDailyStateService {
  constructor(private readonly prisma: PrismaClient) {}
  async save(userId: string, localDate: string, timezone: string, state: DashboardDayState, action: DashboardPrimaryActionType, ids: { activeWorkoutId?: string; plannedWorkoutId?: string; activeProgramId?: string }, counts: { completed: number; planned: number }) {
    const now = new Date();
    return this.prisma.userDailyState.upsert({ where: { userId_localDate_timezone: { userId, localDate: new Date(`${localDate}T00:00:00Z`), timezone } }, create: { userId, localDate: new Date(`${localDate}T00:00:00Z`), timezone, state, primaryActionType: action, ...ids, completedWorkoutCount: counts.completed, plannedWorkoutCount: counts.planned, sourceVersion: 1n, calculatedAt: now, expiresAt: new Date(now.getTime() + 300000) }, update: { state, primaryActionType: action, ...ids, completedWorkoutCount: counts.completed, plannedWorkoutCount: counts.planned, calculatedAt: now, expiresAt: new Date(now.getTime() + 300000), version: { increment: 1 } } });
  }
}
