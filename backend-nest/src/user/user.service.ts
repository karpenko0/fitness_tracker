import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient, UserStatus } from '@prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Inject } from '@nestjs/common';

@Injectable()
export class UserService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true, roles: { include: { role: true } } },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new NotFoundException({ code: 'UNAUTHORIZED', message: 'User not found or deleted' });
    }

    return {
      user: {
        id: user.id,
        telegramId: user.telegramId.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.telegramUsername,
        telegramPhotoUrl: user.telegramPhotoUrl,
        roles: user.roles.map(r => r.role.code),
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      profile: user.profile,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({ code: 'ACCOUNT_DELETED', message: 'Account deleted or blocked' });
    }

    const profile = await this.prisma.userProfile.update({
      where: { userId },
      data: {
        ...this.normalizeProfile(dto),
      },
    });

    if (this.prisma.outboxEvent) {
      await this.prisma.outboxEvent.create({ data: { userId, type: 'profile.updated', payload: { profileId: profile.id } } });
    }

    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        targetUserId: userId,
        action: 'PROFILE_UPDATED',
        entityType: 'UserProfile',
        entityId: profile.id,
        metadata: { updatedFields: Object.keys(dto) },
      },
    });

    return { profile };
  }

  async deleteAccount(userId: string, confirmation: string) {
    if (confirmation !== 'DELETE_MY_ACCOUNT') {
      throw new BadRequestException({ code: 'CONFIRMATION_REQUIRED', message: 'Confirmation value is required' });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    if (!user) {
      return;
    }

    if (user.status === UserStatus.DELETED) {
      return;
    }

    await this.prisma.$transaction(async prisma => {
      await prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'ACCOUNT_DELETED' } });
      await prisma.userProfile.update({
        where: { userId },
        data: {
          gender: null,
          birthDate: null,
          heightCm: null,
          weightKg: null,
          fitnessGoal: null,
          experienceLevel: null,
          trainingLocation: null,
          trainingFrequency: null,
          preferredWorkoutDuration: null,
          equipment: [],
          limitations: null,
          trainingPreferences: [],
          nutritionPlanNeeded: false,
          notificationDays: [],
          notificationTime: null,
          locale: 'ru',
          timezone: 'UTC',
          onboardingCompleted: false,
        },
      });
      await prisma.user.update({
        where: { id: userId },
        data: {
          status: UserStatus.DELETED,
          deletedAt: new Date(),
          telegramUsername: null,
          firstName: 'deleted',
          lastName: null,
          telegramLanguageCode: null,
          telegramPhotoUrl: null,
        },
      });
      await prisma.auditLog.create({
        data: {
          actorUserId: userId,
          targetUserId: userId,
          action: 'USER_DELETION_REQUESTED',
          entityType: 'User',
          entityId: userId,
        },
      });
    });
  }

  private normalizeProfile(dto: UpdateProfileDto) {
    const normalized = { ...dto } as any;
    if (dto.birthDate === null) {
      normalized.birthDate = null;
    }
    if (dto.equipment) {
      normalized.equipment = dto.equipment;
    }
    if (dto.trainingPreferences) {
      normalized.trainingPreferences = dto.trainingPreferences;
    }
    if (dto.notificationDays) {
      normalized.notificationDays = dto.notificationDays;
    }
    return normalized;
  }
}
