import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { ProgramMatchingService } from '../program/program-matching.service';

@Injectable()
export class StarterProgramRecommendationService {
  private readonly matching: ProgramMatchingService;
  constructor(prisma: PrismaClient, @Optional() config?: ConfigService) {
    this.matching = new ProgramMatchingService(prisma, config);
  }

  recommend(data: Record<string, any>, client?: PrismaClient) {
    return this.matching.recommend(data, client);
  }
}
