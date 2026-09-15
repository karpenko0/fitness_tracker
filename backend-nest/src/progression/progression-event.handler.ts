import { Injectable } from '@nestjs/common';
import { ProgressionService } from './progression.service';

/** Idempotent consumer entry point for transactional-outbox delivery. */
@Injectable()
export class ProgressionEventHandler {
  constructor(private readonly progression: ProgressionService) {}
  async handleWorkoutCompleted(payload: { workoutId: string }) {
    return this.progression.calculateCompletedWorkout(payload.workoutId);
  }
}
