import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { 
  CreateMeasurementDto, 
  UpdateMeasurementDto, 
  MeasurementValueDto 
} from './dto/measurement.dto';


/**
 * DTO keys of CircumferencesCmDto (camelCase) -> MeasurementMetric enum values (UPPER_SNAKE).
 */
export const MEASUREMENT_METRIC_BY_DTO_KEY: Record<string, string> = {
  neck: 'NECK',
  chest: 'CHEST',
  waist: 'WAIST',
  abdomen: 'ABDOMEN',
  hips: 'HIPS',
  bicepsLeft: 'BICEPS_LEFT',
  bicepsRight: 'BICEPS_RIGHT',
  thighLeft: 'THIGH_LEFT',
  thighRight: 'THIGH_RIGHT',
  calfLeft: 'CALF_LEFT',
  calfRight: 'CALF_RIGHT',
};

@Injectable()
export class MeasurementService {
  private readonly logger = new Logger(MeasurementService.name);

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

  /**
   * Validates that the measuredAt date is not more than 24 hours in the future
   */
  private validateMeasurementDate(measuredAt: Date): void {
    const now = new Date();
    const twentyFourHoursLater = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    if (measuredAt > twentyFourHoursLater) {
      throw new Error('Measurement date cannot be more than 24 hours in the future');
    }
  }

  async create(userId: string, dto: CreateMeasurementDto) {
    // Validate measurement date is not more than 24 hours in the future
    const measurementDate = new Date(dto.measuredAt);
    this.validateMeasurementDate(measurementDate);

    // Check if a measurement already exists for the user on the same local date
    const localDate = new Date(dto.measuredAt);
    localDate.setHours(0, 0, 0, 0);
    const existing = await this.prisma.measurement.findFirst({
      where: {
        userId,
        measuredAt: {
          gte: localDate,
          lt: new Date(localDate.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    });

    if (existing) {
      throw new Error('Measurement already exists for this date');
    }

    // Check if it's a completely empty measurement (no weight and no circumferences)
    if (
      (dto.weightKg === null || dto.weightKg === undefined) &&
      (!dto.circumferencesCm || 
       Object.values(dto.circumferencesCm).every(v => v === null || v === undefined))
    ) {
      throw new Error('Measurement must contain at least weight or one circumference value');
    }

    // Create the measurement
    const measurement = await this.prisma.measurement.create({
      data: {
        userId,
        measuredAt: measurementDate,
        timezone: dto.timezone,
        note: dto.note,
      },
    });

    // Create measurement values
    const valueData: { measurementId: string; metric: any; value: any }[] = [];
    if (dto.weightKg !== null && dto.weightKg !== undefined) {
      valueData.push({
        measurementId: measurement.id,
        metric: 'WEIGHT',
        value: dto.weightKg,
      });
    }

    if (dto.circumferencesCm) {
      for (const [key, value] of Object.entries(dto.circumferencesCm)) {
        const metric = MEASUREMENT_METRIC_BY_DTO_KEY[key];
        if (metric && value !== null && value !== undefined) {
          valueData.push({
            measurementId: measurement.id,
            metric: metric as any,
            value,
          });
        }
      }
    }

    if (valueData.length > 0) {
      await this.prisma.measurementValue.createMany({
        data: valueData,
      });
    }

    return this.findOne(measurement.id, userId);
  }

  async findAll(userId: string, options: { skip?: number; take?: number; orderBy?: any } = {}) {
    // Enforce Free/Pro restrictions: Free users can only see last 30 days
    const cutoffDate = await this.getCutoffDate(userId);
    
    return this.prisma.measurement.findMany({
      where: { 
        userId,
        measuredAt: {
          gte: cutoffDate
        }
      },
      skip: options.skip,
      take: options.take,
      orderBy: options.orderBy || { measuredAt: 'desc' },
      include: {
        values: true,
      },
    });
  }

  async findOne(id: string, userId: string) {
    const measurement = await this.prisma.measurement.findUnique({
      where: { id },
      include: {
        values: true,
      },
    });

    if (!measurement) {
      throw new NotFoundException(`Measurement with ID ${id} not found`);
    }

    // Check ownership
    if (measurement.userId !== userId) {
      throw new NotFoundException(`Measurement with ID ${id} not found`);
    }

    return measurement;
  }

  async update(id: string, dto: UpdateMeasurementDto, userId: string) {
    const measurement = await this.prisma.measurement.findUnique({
      where: { id },
    });

    if (!measurement) {
      throw new NotFoundException(`Measurement with ID ${id} not found`);
    }

    // Check ownership
    if (measurement.userId !== userId) {
      throw new NotFoundException(`Measurement with ID ${id} not found`);
    }

    // Validate measurement date if provided
    if (dto.measuredAt) {
      const measurementDate = new Date(dto.measuredAt);
      this.validateMeasurementDate(measurementDate);
    }

    // Check if it's a completely empty measurement (no weight and no circumferences)
    if (
      (dto.weightKg === null || dto.weightKg === undefined) &&
      (!dto.circumferencesCm || 
       Object.values(dto.circumferencesCm).every(v => v === null || v === undefined))
    ) {
      throw new Error('Measurement must contain at least weight or one circumference value');
    }

    // Update measurement
    const updatedMeasurement = await this.prisma.measurement.update({
      where: { id },
      data: {
        measuredAt: dto.measuredAt ? new Date(dto.measuredAt) : undefined,
        timezone: dto.timezone,
        note: dto.note,
      },
    });

    // Update measurement values
    // For simplicity, we'll delete all existing values and create new ones
    // In a real application, we might want to do a more efficient update
    await this.prisma.measurementValue.deleteMany({
      where: { measurementId: id },
    });

    const valueData: { measurementId: string; metric: any; value: any }[] = [];
    if (dto.weightKg !== null && dto.weightKg !== undefined) {
      valueData.push({
        measurementId: id,
        metric: 'WEIGHT',
        value: dto.weightKg,
      });
    }

    if (dto.circumferencesCm) {
      for (const [key, value] of Object.entries(dto.circumferencesCm)) {
        const metric = MEASUREMENT_METRIC_BY_DTO_KEY[key];
        if (metric && value !== null && value !== undefined) {
          valueData.push({
            measurementId: id,
            metric: metric as any,
            value,
          });
        }
      }
    }

    if (valueData.length > 0) {
      await this.prisma.measurementValue.createMany({
        data: valueData,
      });
    }

    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string) {
    const measurement = await this.prisma.measurement.findUnique({
      where: { id },
    });

    if (!measurement) {
      throw new NotFoundException(`Measurement with ID ${id} not found`);
    }

    // Check ownership
    if (measurement.userId !== userId) {
      throw new NotFoundException(`Measurement with ID ${id} not found`);
    }

    // Delete measurement values first due to foreign key constraint
    await this.prisma.measurementValue.deleteMany({
      where: { measurementId: id },
    });

    return this.prisma.measurement.delete({
      where: { id },
    });
  }
}