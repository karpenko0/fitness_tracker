import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { PrismaClient, ProgressPhotoPose, ProgressPhotoStatus } from '@prisma/client';
import { 
  CreateProgressPhotoDto, 
  UpdateProgressPhotoDto 
} from './dto/progress-photo.dto';

@Injectable()
export class ProgressPhotoService {
  private readonly logger = new Logger(ProgressPhotoService.name);

  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  /**
   * Checks if the user has Pro subscription
   */
  private async isProUser(userId: string): Promise<boolean> {
    const subscription = await this.prisma.subscriptionEntitlement.findUnique({
      where: { userId },
    });
    
    return subscription?.plan === 'PRO';
  }

  /**
   * Calculates the cutoff date based on user's subscription level
   * For FREE users: 30 days ago
   * For PRO users: no limit (we'll use a very old date to effectively mean no limit)
   */
  private async getCutoffDate(userId: string): Promise<Date> {
    const isPro = await this.isProUser(userId);
    const cutoffDate = new Date();
    
    if (!isPro) {
      // Free users: limit to last 30 days
      cutoffDate.setDate(cutoffDate.getDate() - 30);
    } else {
      // Pro users: effectively no limit (use a date far in the past)
      cutoffDate.setFullYear(cutoffDate.getFullYear() - 10); // 10 years ago
    }
    
    return cutoffDate;
  }

  async create(userId: string, dto: CreateProgressPhotoDto) {
    // Check if the user has reached the photo limit (for Free users)
    const isPro = await this.isProUser(userId);
    if (!isPro) {
      const photoCount = await this.prisma.progressPhoto.count({
        where: { userId },
      });
      if (photoCount >= 5) {
        throw new Error('Free users are limited to 5 photos total');
      }
    }

    // Check if a progress photo already exists for the user on the same local date and pose
    const existing = await this.prisma.progressPhoto.findFirst({
      where: {
        userId,
        localDate: new Date(dto.localDate),
        pose: dto.pose as ProgressPhotoPose,
      },
    });

    if (existing) {
      throw new Error('Progress photo already exists for this date and pose');
    }

    // Create the progress photo
    const progressPhoto = await this.prisma.progressPhoto.create({
      data: {
        userId,
        measurementId: dto.measurementId,
        localDate: new Date(dto.localDate),
        pose: dto.pose as ProgressPhotoPose,
        storageKey: dto.storageKey,
        previewStorageKey: dto.previewStorageKey,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        status: (dto.status as ProgressPhotoStatus) || 'PENDING',
      },
    });

    return this.findOne(progressPhoto.id, userId);
  }

  async findAll(userId: string, options: { skip?: number; take?: number; orderBy?: any } = {}) {
    // Enforce Free/Pro restrictions: Free users can only see last 30 days
    const cutoffDate = await this.getCutoffDate(userId);
    
    return this.prisma.progressPhoto.findMany({
      where: { 
        userId,
        localDate: {
          gte: cutoffDate
        }
      },
      skip: options.skip,
      take: options.take,
      orderBy: options.orderBy || { localDate: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const progressPhoto = await this.prisma.progressPhoto.findUnique({
      where: { id },
    });

    if (!progressPhoto) {
      throw new NotFoundException(`Progress photo with ID ${id} not found`);
    }

    // Check ownership
    if (progressPhoto.userId !== userId) {
      throw new NotFoundException(`Progress photo with ID ${id} not found`);
    }

    // For Free users, also check that the photo is within the last 30 days
    const isPro = await this.isProUser(userId);
    if (!isPro) {
      const cutoffDate = await this.getCutoffDate(userId);
      if (progressPhoto.localDate < cutoffDate) {
        throw new NotFoundException(`Progress photo with ID ${id} not found`);
      }
    }

    return progressPhoto;
  }

  async update(id: string, dto: UpdateProgressPhotoDto, userId: string) {
    const progressPhoto = await this.prisma.progressPhoto.findUnique({
      where: { id },
    });

    if (!progressPhoto) {
      throw new NotFoundException(`Progress photo with ID ${id} not found`);
    }

    // Check ownership
    if (progressPhoto.userId !== userId) {
      throw new NotFoundException(`Progress photo with ID ${id} not found`);
    }

    // For Free users, also check that the photo is within the last 30 days (if we are updating the date, we should validate the new date)
    const isPro = await this.isProUser(userId);
    if (!isPro) {
      const cutoffDate = await this.getCutoffDate(userId);
      const localDate = dto.localDate ? new Date(dto.localDate) : progressPhoto.localDate;
      if (localDate < cutoffDate) {
        throw new NotFoundException(`Progress photo with ID ${id} not found`);
      }
    }

    // Update progress photo
    const updatedProgressPhoto = await this.prisma.progressPhoto.update({
      where: { id },
      data: {
        measurementId: dto.measurementId,
        localDate: dto.localDate ? new Date(dto.localDate) : undefined,
        pose: dto.pose as ProgressPhotoPose | undefined,
        storageKey: dto.storageKey,
        previewStorageKey: dto.previewStorageKey,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        status: dto.status as ProgressPhotoStatus | undefined,
      },
    });

    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string) {
    const progressPhoto = await this.prisma.progressPhoto.findUnique({
      where: { id },
    });

    if (!progressPhoto) {
      throw new NotFoundException(`Progress photo with ID ${id} not found`);
    }

    // Check ownership
    if (progressPhoto.userId !== userId) {
      throw new NotFoundException(`Progress photo with ID ${id} not found`);
    }

    // For Free users, also check that the photo is within the last 30 days (though deletion should be allowed regardless? 
    // According to spec, Free users can delete their own photos. We'll allow deletion as long as they own it.)
    // We'll not apply the cutoff date check for deletion.

    return this.prisma.progressPhoto.delete({
      where: { id },
    });
  }
}