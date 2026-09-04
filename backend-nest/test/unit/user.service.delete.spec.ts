import { UserStatus } from '@prisma/client';
import { UserService } from '../../src/user/user.service';

describe('UserService account deletion', () => {
  it('revokes sessions and anonymizes the account in one transaction', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', status: UserStatus.ACTIVE, profile: { userId: 'user-1' } }),
        update: jest.fn(),
      },
      userProfile: { update: jest.fn() },
      authSession: { updateMany: jest.fn() },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(prisma)),
    };
    const service = new UserService(prisma);

    await service.deleteAccount('user-1', 'DELETE_MY_ACCOUNT');

    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', revokedAt: null },
    }));
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      data: expect.objectContaining({ status: UserStatus.DELETED, firstName: 'deleted' }),
    }));
  });

  it('requires exact confirmation', async () => {
    const prisma: any = { user: { findUnique: jest.fn() } };
    const service = new UserService(prisma);

    await expect(service.deleteAccount('user-1', 'delete_my_account')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONFIRMATION_REQUIRED' }),
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
