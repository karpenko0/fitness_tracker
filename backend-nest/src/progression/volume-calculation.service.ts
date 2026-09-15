import { Injectable } from '@nestjs/common';
import { CalculationSet, calculateSetVolumeKg } from './progression.calculations';

@Injectable()
export class VolumeCalculationService {
  calculateSet(set: CalculationSet, effectiveWeightKg?: number | null) { return calculateSetVolumeKg(set, effectiveWeightKg); }
  calculateExercise(sets: CalculationSet[], effectiveWeightKg?: number | null) {
    const values = sets.map(set => this.calculateSet(set, effectiveWeightKg));
    return values.some(value => value === null) && effectiveWeightKg == null ? null : values.reduce<number>((sum, value) => sum + (value || 0), 0);
  }
}
