import { Module } from '@nestjs/common';
import { EntitlementRepository } from './entitlement.repository';
import { EntitlementService } from './entitlement.service';
import { ExerciseCatalogRepository } from './exercise-catalog.repository';
import { ExerciseCatalogService } from './exercise-catalog.service';
import { ExerciseController } from './exercise.controller';
import { ProgramController } from './program.controller';
import { ProgramMatchingService } from './program-matching.service';
import { ProgramMetricsService } from './program-metrics.service';
import { ProgramRepository } from './program.repository';
import { ProgramService } from './program.service';

@Module({
  controllers: [ProgramController, ExerciseController],
  providers: [ProgramService, ExerciseCatalogService, EntitlementService, ProgramMatchingService, ProgramMetricsService, ProgramRepository, ExerciseCatalogRepository, EntitlementRepository],
  exports: [ProgramService, ExerciseCatalogService, EntitlementService, ProgramMatchingService, ProgramMetricsService, ProgramRepository, ExerciseCatalogRepository, EntitlementRepository],
})
export class ProgramModule {}
