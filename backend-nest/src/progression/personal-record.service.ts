import { Injectable } from '@nestjs/common';
import { PersonalRecordType, PersonalRecordUnit, Prisma } from '@prisma/client';

type RecordCandidate = { type: PersonalRecordType; value: number; unit: PersonalRecordUnit; sourceSetId?: string; exerciseId?: string | null; comparisonWeightKg?: number };

@Injectable()
export class PersonalRecordService {
  async createNewRecords(tx: Prisma.TransactionClient, userId: string, workoutId: string, achievedAt: Date, calculationVersion: string, candidates: RecordCandidate[]) {
    const created: Array<{ type: PersonalRecordType; exerciseId: string | null; previousValue: number | null; newValue: number }> = [];
    for (const candidate of candidates) {
      const eligible = { userId, exerciseId: candidate.exerciseId ?? null, recordType: candidate.type, revokedAt: null, NOT: { sourceWorkoutId: workoutId } };
      const previous = candidate.type === 'MAX_REPS' && candidate.comparisonWeightKg != null
        ? (await tx.personalRecord.findMany({ where: eligible, include: { sourceSet: { select: { actualWeightKg: true } } }, orderBy: { value: 'desc' } })).find(record => record.sourceSet?.actualWeightKg != null && Math.abs(Number(record.sourceSet.actualWeightKg) - candidate.comparisonWeightKg!) <= 0.25) ?? null
        : await tx.personalRecord.findFirst({ where: eligible, orderBy: { value: 'desc' } });
      if (previous && Number(previous.value) >= candidate.value) continue;
      const existing = await tx.personalRecord.findFirst({ where: { sourceWorkoutId: workoutId, exerciseId: candidate.exerciseId ?? null, recordType: candidate.type } });
      if (existing) continue;
      await tx.personalRecord.create({ data: { userId, exerciseId: candidate.exerciseId ?? null, recordType: candidate.type, value: candidate.value, unit: candidate.unit, sourceWorkoutId: workoutId, sourceSetId: candidate.sourceSetId, previousValue: previous ? Number(previous.value) : null, achievedAt, calculationVersion } });
      created.push({ type: candidate.type, exerciseId: candidate.exerciseId ?? null, previousValue: previous ? Number(previous.value) : null, newValue: candidate.value });
    }
    return created;
  }
}
