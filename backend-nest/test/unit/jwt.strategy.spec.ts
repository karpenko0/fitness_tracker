import { UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { JwtStrategy } from '../../src/auth/strategies/jwt.strategy';

describe('JwtStrategy', () => {
  const configService = { get: jest.fn().mockReturnValue('test-access-secret') };
  const prisma = { authSession: { findUnique: jest.fn() } };
  const payload = { sub: 'user-1', sessionId: 'session-1', roles: ['USER'] };
  let strategy: JwtStrategy;

  beforeEach(() => {
    prisma.authSession.findUnique.mockReset();
    strategy = new JwtStrategy(configService as any, prisma as any);
  });

  it('accepts an active session for an active user', async () => {
    prisma.authSession.findUnique.mockResolvedValue({
      userId: payload.sub,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { status: UserStatus.ACTIVE },
    });

    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: payload.sub,
      sessionId: payload.sessionId,
      roles: ['USER'],
    });
  });

  it.each([
    ['session is revoked', { revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), status: UserStatus.ACTIVE }],
    ['session is expired', { revokedAt: null, expiresAt: new Date(Date.now() - 1), status: UserStatus.ACTIVE }],
    ['user is deleted', { revokedAt: null, expiresAt: new Date(Date.now() + 60_000), status: UserStatus.DELETED }],
  ])('rejects the access token when %s', async (_caseName, state) => {
    prisma.authSession.findUnique.mockResolvedValue({
      userId: payload.sub,
      revokedAt: state.revokedAt,
      expiresAt: state.expiresAt,
      user: { status: state.status },
    });

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
