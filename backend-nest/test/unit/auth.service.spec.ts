import { UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from '../../src/auth/auth.service';

describe('AuthService refresh rotation', () => {
  it('does not issue a second session when the matched token was concurrently revoked', async () => {
    const refreshToken = 'rt_original';
    const prisma: any = {
      authSession: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'session-1',
          userId: 'user-1',
          refreshTokenHash: await argon2.hash(refreshToken),
          user: { status: UserStatus.ACTIVE, roles: [{ role: { code: 'USER' } }] },
        }]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(prisma)),
    };
    const service = new AuthService(
      { sign: jest.fn() } as any,
      { get: jest.fn() } as any,
      {} as any,
      prisma as any,
    );

    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'session-1', revokedAt: null }),
    }));
  });
});
