import { Module } from '@nestjs/common';
import { WorkoutController } from './workout.controller';
import { WorkoutService } from './workout.service';
import { WorkoutCatalogController } from './workout-catalog.controller';
import { WorkoutCatalogService } from './workout-catalog.service';

@Module({ controllers: [WorkoutController, WorkoutCatalogController], providers: [WorkoutService, WorkoutCatalogService] })
export class WorkoutModule {}
