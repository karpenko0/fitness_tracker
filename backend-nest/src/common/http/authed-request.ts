import { BadRequestException } from '@nestjs/common';

export interface AuthedRequest {
  user: { userId: string; roles?: string[] };
}

/** skip ≥ 0, take 1..100 (по умолчанию 20); иначе 400 VALIDATION_ERROR. */
export function pageOptions(skip?: string, take?: string) {
  const s = skip === undefined ? 0 : Number(skip);
  const t = take === undefined ? 20 : Number(take);
  if (!Number.isInteger(s) || s < 0 || !Number.isInteger(t) || t < 1 || t > 100) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'skip must be >= 0, take must be 1..100' });
  }
  return { skip: s, take: t };
}
