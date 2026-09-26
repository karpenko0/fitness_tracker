/**
 * DI-токен Prisma без compile-time зависимости от сгенерированного клиента:
 * модуль компилируется и тестируется даже без `prisma generate` (in-memory фейк в тестах).
 */
function resolvePrismaToken(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@prisma/client').PrismaClient;
  } catch {
    return Symbol.for('PrismaClient:not-generated');
  }
}

export const PRISMA: any = resolvePrismaToken();

/** Prisma client или transaction client. */
export type Db = any;

export function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as any).code === 'P2002';
}

export class OptimisticLockError extends Error {
  constructor(entity: string) {
    super(`Optimistic lock failed for ${entity}`);
  }
}
