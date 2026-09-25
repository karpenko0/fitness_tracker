import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

/**
 * Shared idempotency for write operations (SPEC-001 §5, SPEC-009 «Безопасность и качество»).
 *
 * Contract (same as the existing inline helpers in workout/program services):
 * - missing key            -> 409 IDEMPOTENCY_KEY_REQUIRED
 * - same key + same body   -> previously stored response (no duplicate write)
 * - same key + other body  -> 409 IDEMPOTENCY_KEY_REUSED
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async run<T>(
    userId: string,
    key: string | undefined,
    payload: unknown,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    status = 200,
  ): Promise<T> {
    if (!key) {
      throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key is required' });
    }
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
      if (previous) {
        if (previous.requestHash !== hash) {
          throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key was used with a different request' });
        }
        return previous.responseBody as T;
      }
      const response = await operation(tx);
      await tx.idempotencyKey.create({
        data: { userId, key, requestHash: hash, responseStatus: status, responseBody: response as object, expiresAt: new Date(Date.now() + 86_400_000) },
      });
      return response;
    });
  }
}
