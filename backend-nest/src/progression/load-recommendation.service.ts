import { Injectable } from '@nestjs/common';
import { ProgressionConfidence, ProgressionReasonCode, Prisma } from '@prisma/client';
import { ALGORITHM_VERSION, CalculationSet, recommendLoad } from './progression.calculations';
import { ProgressionMetricsService } from './progression-metrics.service';

@Injectable()
export class LoadRecommendationService {
  constructor(private readonly metrics: ProgressionMetricsService) {}
  async updateForExercise(tx: Prisma.TransactionClient, userId: string, exerciseId: string, basedOnWorkoutId: string, sets: CalculationSet[], equipment: string | null, weightIncrementKg: number | null) {
    const allHistory = await tx.exercisePerformance.findMany({ where: { userId, exerciseId }, orderBy: { performedAt: 'desc' }, take: 20 });
    const history = allHistory.filter(item => item.workoutId !== basedOnWorkoutId);
    const recentHistory = history.filter(item => item.performedAt >= new Date(Date.now() - 90 * 86_400_000));
    const previousWeightKg = history[0]?.maxWeightKg == null ? null : Number(history[0].maxWeightKg);
    const confidence: ProgressionConfidence = recentHistory.length >= 3 ? 'HIGH' : recentHistory.length ? 'MEDIUM' : history.length ? 'LOW' : 'NONE';
    const increment = weightIncrementKg && weightIncrementKg > 0 ? weightIncrementKg : equipment === 'BARBELL' ? 2.5 : 1;
    const config = await tx.progressionAlgorithmConfig.findUnique({ where: { algorithmVersion: ALGORITHM_VERSION } });
    const policy = { increasePercent: config ? Number(config.increasePercent) : 5, decreasePercent: config ? Number(config.decreasePercent) : 10, maxIncreasePercent: config ? Number(config.maxIncreasePercent) : 10 };
    const plannedWeightKg = sets.filter(set => set.setType === 'WORKING').map(set => set.plannedWeightKg).find((weight): weight is number => weight != null && weight >= 0);
    const calculated = recommendLoad(sets, previousWeightKg, increment, policy, equipment);
    const decision = calculated.reasonCode === 'INSUFFICIENT_DATA' && plannedWeightKg != null
      ? { weightKg: plannedWeightKg, reasonCode: 'PLAN_VALUE' as const, targetRepsMin: calculated.targetRepsMin, targetRepsMax: calculated.targetRepsMax }
      : calculated;
    const targetRepsMin = 'targetRepsMin' in decision ? decision.targetRepsMin ?? null : null;
    const targetRepsMax = 'targetRepsMax' in decision ? decision.targetRepsMax ?? null : null;
    const recommendation = await tx.exerciseProgressionRecommendation.upsert({
      where: { userId_exerciseId_algorithmVersion: { userId, exerciseId, algorithmVersion: ALGORITHM_VERSION } },
      create: { userId, exerciseId, recommendedWeightKg: decision.weightKg, targetRepsMin, targetRepsMax, targetRpe: 8, confidence, reasonCode: decision.reasonCode as ProgressionReasonCode, basedOnWorkoutId, algorithmVersion: ALGORITHM_VERSION, validUntil: new Date(Date.now() + 30 * 86_400_000) },
      update: { recommendedWeightKg: decision.weightKg, targetRepsMin, targetRepsMax, targetRpe: 8, confidence, reasonCode: decision.reasonCode as ProgressionReasonCode, basedOnWorkoutId, validUntil: new Date(Date.now() + 30 * 86_400_000), version: { increment: 1 } },
    });
    this.metrics.event(decision.weightKg == null ? 'progression.recommendation_not_available' : 'progression.recommendation_created', { userId, exerciseId, basedOnWorkoutId, reasonCode: decision.reasonCode, confidence, algorithmVersion: ALGORITHM_VERSION });
    this.metrics.increment('progression_recommendations_total', { reason_code: decision.reasonCode, confidence });
    if (decision.reasonCode === 'PROGRESSIVE_OVERLOAD') this.metrics.increment('progression_recommendation_increase_total', { equipment_type: equipment || 'UNKNOWN' });
    if (decision.reasonCode === 'REDUCE_LOAD') this.metrics.increment('progression_recommendation_decrease_total', { reason_code: decision.reasonCode });
    if (decision.reasonCode === 'MAINTAIN_LOAD' || decision.reasonCode === 'PAIN_OR_DISCOMFORT') this.metrics.increment('progression_recommendation_hold_total', { reason_code: decision.reasonCode });
    if (decision.reasonCode === 'INSUFFICIENT_DATA') this.metrics.increment('progression_insufficient_data_total', { source: 'history' });
    return recommendation;
  }
}
