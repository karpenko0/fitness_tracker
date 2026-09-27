import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Rate limit по пользователю, если в запросе валидный access-токен, иначе по IP.
 * Глобальный guard выполняется раньше JwtAuthGuard, поэтому подпись HS256 проверяется здесь
 * (поддельный sub не даёт обойти лимит: без валидной подписи ключ — IP).
 * Иначе все пользователи за одним NAT/прокси делят один лимит (например, 10 invoice/мин).
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const sub = verifiedSub(req?.headers?.authorization, process.env.JWT_ACCESS_SECRET);
    return sub ? `user:${sub}` : `ip:${req.ips?.length ? req.ips[0] : req.ip}`;
  }
}

export function verifiedSub(header: unknown, secret?: string): string | null {
  if (!secret || typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const parts = header.slice(7).split('.');
  if (parts.length !== 3) return null;
  try {
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (head.alg !== 'HS256') return null;
    const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
    const given = Buffer.from(parts[2], 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
