import { Injectable } from '@nestjs/common';
import { calculateEpleyOneRmKg } from './progression.calculations';

@Injectable()
export class OneRmCalculationService {
  calculate(weightKg: number | null, reps: number | null) { return calculateEpleyOneRmKg(weightKg, reps); }
}
