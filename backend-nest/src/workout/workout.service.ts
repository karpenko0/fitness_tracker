import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, PrismaClient, UserStatus, WorkoutSessionStatus, WorkoutStatus } from '@prisma/client';

type Transition = 'start' | 'pause' | 'resume' | 'complete';

@Injectable()
export class WorkoutService {
  constructor(private readonly prisma: PrismaClient) {}

  async transition(userId: string, workoutId: string, transition: Transition, idempotencyKey?: string) {
    if (!idempotencyKey) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key is required' });
    const requestHash = createHash('sha256').update(JSON.stringify({ workoutId, transition })).digest('hex');
    return this.prisma.$transaction(async tx => {
      const existing = await tx.idempotencyKey.findUnique({ where: { userId_key: { userId, key: idempotencyKey } } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key was used with a different request' });
        return existing.responseBody;
      }
      const workout = await tx.workout.findFirst({ where: { id: workoutId, userId }, include: { sessions: true } });
      if (!workout) throw new NotFoundException({ code: 'WORKOUT_NOT_FOUND', message: 'Workout was not found' });
      const result = await this.applyTransition(tx, workout, transition);
      const response = { workout: result };
      await tx.outboxEvent.create({ data: { userId, type: `workout.${transition}`, payload: { workoutId } } });
      await tx.idempotencyKey.create({ data: { userId, key: idempotencyKey, requestHash, responseStatus: 200, responseBody: response, expiresAt: new Date(Date.now() + 86400000) } });
      return response;
    });
  }

  private async applyTransition(tx: Prisma.TransactionClient, workout: any, transition: Transition) {
    const now = new Date();
    if (transition === 'start') {
      if (workout.status !== WorkoutStatus.PLANNED) throw this.invalidTransition(workout.status, transition);
      const updated = await tx.workout.updateMany({ where: { id: workout.id, userId: workout.userId, status: WorkoutStatus.PLANNED, version: workout.version }, data: { status: WorkoutStatus.IN_PROGRESS, startedAt: now, version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException({ code: 'WORKOUT_CONFLICT', message: 'Workout was changed concurrently' });
      await tx.workoutSession.create({ data: { workoutId: workout.id, status: WorkoutSessionStatus.IN_PROGRESS, startedAt: now } });
    } else if (transition === 'pause') {
      if (workout.status !== WorkoutStatus.IN_PROGRESS || !workout.sessions[0]) throw this.invalidTransition(workout.status, transition);
      await this.updateSession(tx, workout.sessions[0], WorkoutSessionStatus.PAUSED, now);
      await tx.workout.update({ where: { id: workout.id }, data: { status: WorkoutStatus.PAUSED, version: { increment: 1 } } });
    } else if (transition === 'resume') {
      if (workout.status !== WorkoutStatus.PAUSED || !workout.sessions[0]) throw this.invalidTransition(workout.status, transition);
      await this.updateSession(tx, workout.sessions[0], WorkoutSessionStatus.IN_PROGRESS, now);
      await tx.workout.update({ where: { id: workout.id }, data: { status: WorkoutStatus.IN_PROGRESS, version: { increment: 1 } } });
    } else {
      if (![WorkoutStatus.IN_PROGRESS, WorkoutStatus.PAUSED].includes(workout.status) || !workout.sessions[0]) throw this.invalidTransition(workout.status, transition);
      const seconds = workout.sessions[0].durationSeconds ?? Math.max(0, (now.getTime() - workout.sessions[0].startedAt.getTime()) / 1000);
      await tx.workoutSession.update({ where: { id: workout.sessions[0].id }, data: { status: WorkoutSessionStatus.COMPLETED, completedAt: now, durationSeconds: Math.round(seconds), version: { increment: 1 } } });
      await tx.workout.update({ where: { id: workout.id }, data: { status: WorkoutStatus.COMPLETED, completedAt: now, version: { increment: 1 } } });
    }
    return tx.workout.findUniqueOrThrow({ where: { id: workout.id }, include: { sessions: true, exercises: { include: { sets: true }, orderBy: { position: 'asc' } } } });
  }

  private async updateSession(tx: Prisma.TransactionClient, session: any, status: WorkoutSessionStatus, now: Date) {
    const result = await tx.workoutSession.updateMany({ where: { id: session.id, version: session.version }, data: { status, pausedAt: status === WorkoutSessionStatus.PAUSED ? now : session.pausedAt, version: { increment: 1 } } });
    if (result.count !== 1) throw new ConflictException({ code: 'WORKOUT_SESSION_CONFLICT', message: 'Workout session was changed concurrently' });
  }

  private invalidTransition(status: string, transition: Transition) { return new ConflictException({ code: 'INVALID_WORKOUT_TRANSITION', message: `Cannot ${transition} workout in ${status} state` }); }
}
