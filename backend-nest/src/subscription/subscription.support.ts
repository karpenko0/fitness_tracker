import { Inject, Injectable } from '@nestjs/common';
import { IDEMPOTENCY_TTL_HOURS } from './subscription.catalog';
import { redactFinancial, stableHash, SubscriptionError } from './subscription.domain';
import { Db, isUniqueViolation, PRISMA } from './subscription.prisma';

export interface AuditEntry {
  actorUserId?: string | null;
  targetUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  requestId?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  [key: string]: unknown;
}

/** audit_logs + outbox_events — всегда внутри бизнес-транзакции, всегда с redaction. */
export async function writeAudit(tx: Db, entry: AuditEntry) {
  const { actorUserId, targetUserId, action, entityType, entityId, requestId, ...rest } = entry;
  await tx.auditLog.create({
    data: {
      actorUserId: actorUserId ?? null,
      targetUserId: targetUserId ?? null,
      action,
      entityType,
      entityId: entityId ?? null,
      requestId: requestId ?? null,
      metadata: redactFinancial(rest) as object,
    },
  });
}

export async function writeOutbox(tx: Db, type: string, userId: string | null, payload: Record<string, unknown>) {
  await tx.outboxEvent.create({ data: { type, userId, payload: redactFinancial({ ...payload, occurredAt: new Date().toISOString() }) as object } });
}

export type IdempotencyStart = { replay: { status: number; body: any } } | { replay: null; recordId: string; resumed: boolean };

/** idempotency_keys: (user_id, operation, key) + hash запроса + сохранённый безопасный ответ. */
@Injectable()
export class FinancialIdempotency {
  constructor(@Inject(PRISMA) private readonly prisma: Db) {}

  async begin(userId: string, operation: string, key: string, request: unknown, now = new Date()): Promise<IdempotencyStart> {
    const requestHash = stableHash(request);
    const where = { userId_operation_key: { userId, operation, key } };
    let row = await this.prisma.financialIdempotencyKey.findUnique({ where });
    if (row && row.expiresAt.getTime() <= now.getTime()) {
      await this.prisma.financialIdempotencyKey.deleteMany({ where: { id: row.id } });
      row = null;
    }
    if (!row) {
      try {
        row = await this.prisma.financialIdempotencyKey.create({
          data: { userId, operation, key, requestHash, expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_HOURS * 3600_000) },
        });
        return { replay: null, recordId: row.id, resumed: false };
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        row = await this.prisma.financialIdempotencyKey.findUnique({ where });
      }
    }
    if (row.requestHash !== requestHash) throw new SubscriptionError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request');
    if (row.responseStatus && row.responseBody) return { replay: { status: row.responseStatus, body: row.responseBody } };
    return { replay: null, recordId: row.id, resumed: true };
  }

  async complete(recordId: string, status: number, body: unknown) {
    await this.prisma.financialIdempotencyKey.update({ where: { id: recordId }, data: { responseStatus: status, responseBody: body as object } });
  }

  async release(recordId: string) {
    await this.prisma.financialIdempotencyKey.deleteMany({ where: { id: recordId, responseStatus: null } });
  }
}
