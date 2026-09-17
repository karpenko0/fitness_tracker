import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { OnboardingDraftService } from './onboarding-draft.service';
import { ProgramMatchingService } from '../program/program-matching.service';
import { ProgramMetricsService } from '../program/program-metrics.service';
import { OnboardingValidationService } from './onboarding-validation.service';
import { OnboardingAnalyticsService } from './onboarding-analytics.service';
import { CompleteOnboardingDto } from './dto/onboarding.dto';

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaClient, private readonly drafts: OnboardingDraftService, private readonly matching: ProgramMatchingService, private readonly metrics: ProgramMetricsService, private readonly validation: OnboardingValidationService, private readonly analytics: OnboardingAnalyticsService) {}

  async status(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({ where: { userId }, select: { onboardingCompleted: true } });
    const draft = profile?.onboardingCompleted
      ? await this.prisma.onboardingDraft.findFirstOrThrow({ where: { userId, status: 'COMPLETED' }, orderBy: { completedAt: 'desc' } })
      : await this.drafts.getOrCreate(userId);
    return { onboardingCompleted: profile?.onboardingCompleted || false, currentStep: draft.currentStep, completedSteps: draft.completedSteps, draft: { ...draft, data: draft.draftData } };
  }
  async updateDraft(userId: string, dto: any) { const draft = await this.drafts.update(userId, dto); return { draft: { ...draft, data: draft.draftData } }; }
  async options(locale: 'ru' | 'en' = 'ru') {
    const labels: Record<string, [string, string]> = { WEIGHT_LOSS: ['Похудение', 'Weight loss'], MUSCLE_GAIN: ['Набор мышц', 'Muscle gain'], MAINTENANCE: ['Поддержание формы', 'Maintenance'], STRENGTH: ['Сила', 'Strength'], ENDURANCE: ['Выносливость', 'Endurance'], HEALTH: ['Здоровье', 'Health'], MOBILITY_RECOVERY: ['Восстановление', 'Mobility recovery'] };
    const equipment = [['BODYWEIGHT', 'Собственный вес', 'Bodyweight'], ['DUMBBELLS', 'Гантели', 'Dumbbells'], ['BARBELL', 'Штанга', 'Barbell'], ['KETTLEBELL', 'Гиря', 'Kettlebell'], ['RESISTANCE_BANDS', 'Резинки', 'Resistance bands']];
    const preferences = [['STRENGTH', 'Силовые тренировки', 'Strength'], ['CARDIO', 'Кардио', 'Cardio'], ['MOBILITY', 'Мобильность', 'Mobility'], ['LOW_IMPACT', 'Низкая ударная нагрузка', 'Low impact']];
    return { fitnessGoals: Object.keys(labels).map(code => ({ code, label: labels[code][locale === 'ru' ? 0 : 1] })), equipment: equipment.map(([code, ru, en]) => ({ code, label: locale === 'ru' ? ru : en })), trainingPreferences: preferences.map(([code, ru, en]) => ({ code, label: locale === 'ru' ? ru : en })), workoutDurations: [15, 30, 45, 60, 90] };
  }
  async preview(userId: string) { const draft = await this.drafts.getOrCreate(userId); const data = this.validation.validateComplete(draft.draftData as Record<string, unknown>);     const result = await this.matching.recommend({ ...data, limitationTags: this.matching.parseLimitationTags(data.limitations) }); this.analytics.event('onboarding.recommendation.previewed', { userId, programId: result.program.id }); return { isReadyForCompletion: true, recommendation: this.programResponse(result.program), warnings: data.fitnessGoal === 'MOBILITY_RECOVERY' ? ['Materials are for general physical activity and do not replace a doctor or rehabilitation specialist.'] : [] }; }
  async complete(userId: string, dto: CompleteOnboardingDto, key?: string) {
    if (!key) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key is required' });
    const hash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');
    const existingKey = await this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
    if (existingKey) {
      if (existingKey.requestHash !== hash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key was used with a different request' });
      return existingKey.responseBody;
    }
    const profile = await this.prisma.userProfile.findUnique({ where: { userId }, select: { onboardingCompleted: true } });
    if (profile?.onboardingCompleted) throw new ConflictException({ code: 'ONBOARDING_ALREADY_COMPLETED', message: 'Onboarding has already been completed' });
    const draft = await this.drafts.getOrCreate(userId);
    const result = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
      const old = await tx.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
      if (old) {
        if (old.requestHash !== hash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key was used with a different request' });
        return old.responseBody;
      }
      const currentDraft = await tx.onboardingDraft.findUniqueOrThrow({ where: { id: draft.id } });
      if (currentDraft.version !== dto.draftVersion) throw new ConflictException({ code: 'ONBOARDING_DRAFT_CONFLICT', message: 'Draft version is stale', details: { version: currentDraft.version } });
      const data = this.validation.validateComplete(currentDraft.draftData as Record<string, unknown>);
      const completedProfile = await tx.userProfile.findUnique({ where: { userId }, select: { onboardingCompleted: true } });
      if (completedProfile?.onboardingCompleted) {
        const completedKey = await tx.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
        if (completedKey) return completedKey.responseBody;
        throw new ConflictException({ code: 'ONBOARDING_ALREADY_COMPLETED', message: 'Onboarding has already been completed' });
      }
      const match = await this.matching.recommend({ ...data, limitationTags: this.matching.parseLimitationTags(data.limitations) }, tx as any);
      const profile = await tx.userProfile.upsert({ where: { userId }, create: { userId, ...this.profileData(data), limitationTags: this.matching.parseLimitationTags(data.limitations), onboardingCompleted: true, onboardingCompletedAt: new Date() }, update: { ...this.profileData(data), limitationTags: this.matching.parseLimitationTags(data.limitations), onboardingCompleted: true, onboardingCompletedAt: new Date() } });
      await tx.userProgramAssignment.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'ARCHIVED' } });
      const assignment = await tx.userProgramAssignment.upsert({ where: { userId_programId_source: { userId, programId: match.program.id, source: 'ONBOARDING' } }, create: { userId, programId: match.program.id, source: 'ONBOARDING' }, update: { status: 'ACTIVE', startedAt: new Date() } });
      const workout = await tx.workout.create({ data: { userId, programAssignmentId: assignment.id, source: 'ONBOARDING', status: 'PLANNED', scheduledFor: this.firstWorkoutAt(data), title: match.program.firstWorkoutTitle } });
      const notificationDays = Array.isArray(data.notificationDays) ? data.notificationDays : [];
      if (notificationDays.length && typeof data.notificationTime === 'string' && typeof data.timezone === 'string') {
        await tx.notification.upsert({ where: { userId_type_source: { userId, type: 'WORKOUT_REMINDER', source: 'ONBOARDING' } }, create: { userId, type: 'WORKOUT_REMINDER', source: 'ONBOARDING', scheduleDays: notificationDays, scheduleTime: data.notificationTime, timezone: data.timezone }, update: { scheduleDays: notificationDays, scheduleTime: data.notificationTime, timezone: data.timezone, status: 'ACTIVE' } });
        await tx.auditLog.create({ data: { actorUserId: userId, targetUserId: userId, action: 'ONBOARDING_REMINDER_CREATED', entityType: 'Notification' } });
      }
      await tx.onboardingDraft.update({ where: { id: currentDraft.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      const response = { onboardingCompleted: true, profile, starterProgram: this.programResponse(match.program), firstWorkout: workout, nextAction: { type: 'START_WORKOUT', label: 'Начать тренировку', deepLink: `/start/${workout.id}` } };
      await tx.auditLog.createMany({ data: [
         { actorUserId: userId, targetUserId: userId, action: 'ONBOARDING_COMPLETED', entityType: 'OnboardingDraft', entityId: currentDraft.id },
        { actorUserId: userId, targetUserId: userId, action: 'STARTER_PROGRAM_ASSIGNED', entityType: 'UserProgramAssignment', entityId: assignment.id },
        { actorUserId: userId, targetUserId: userId, action: 'program.auto_assigned', entityType: 'PROGRAM', entityId: match.program.id },
        { actorUserId: userId, targetUserId: userId, action: 'ONBOARDING_WORKOUT_CREATED', entityType: 'Workout', entityId: workout.id },
      ] });
        await tx.outboxEvent.create({ data: { userId, type: 'onboarding.completed', payload: { draftId: currentDraft.id, programId: match.program.id, fallback: match.fallback, matchType: match.matchType } } });
      await tx.idempotencyKey.create({ data: { userId, key, requestHash: hash, responseStatus: 201, responseBody: response, expiresAt: new Date(Date.now() + 86400000) } });
      this.metrics.increment('program_auto_assigned_total', { match_type: match.matchType });
      return response;
    });
    this.analytics.event('onboarding.completed', { userId });
    this.metrics.event('program.auto_assigned', { userId });
    return result;
  }
  private profileData(data: any) { const result = { ...data }; if (result.birthDate) result.birthDate = new Date(`${result.birthDate}T00:00:00Z`); return result; }
  private programResponse(program: any) { return { id: program.id, title: program.title, goal: program.goals?.[0], level: program.levels?.[0], workoutsPerWeek: program.workoutsPerWeek, durationMinutes: program.durationMinutes }; }
  private firstWorkoutAt(data: any) {
    const timezone = typeof data.timezone === 'string' ? data.timezone : 'UTC';
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = Object.fromEntries(formatter.formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    const localNow = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12));
    const selectedDays: number[] = Array.isArray(data.notificationDays) && data.notificationDays.length ? data.notificationDays : [((localNow.getUTCDay() + 6) % 7) + 1];
    const today = ((localNow.getUTCDay() + 6) % 7) + 1;
    const delta = Math.min(...selectedDays.map(day => (day - today + 7) % 7 || 7));
    const [hours, minutes] = typeof data.notificationTime === 'string' ? data.notificationTime.split(':').map(Number) : [9, 0];
    const targetLocal = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + delta, hours, minutes));
    const offsetParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(targetLocal).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    const match = String(offsetParts.timeZoneName || 'GMT').match(/GMT([+-])(\d{2}):?(\d{2})?/);
    const offsetMinutes = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] || 0)) : 0;
    return new Date(targetLocal.getTime() - offsetMinutes * 60000);
  }
}
