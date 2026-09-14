import { Injectable } from '@nestjs/common';
import { PrismaClient, WorkoutExerciseKind } from '@prisma/client';
import { DashboardPriorityService } from './dashboard-priority.service';
import { DashboardTimezoneService } from './timezone.service';

const ACTION_TITLES: Record<string, string> = {
  RESUME_WORKOUT: 'Продолжить тренировку',
  CONTINUE_ONBOARDING: 'Настроить план тренировок',
  START_WORKOUT: 'Начать тренировку',
  RESCHEDULE_WORKOUT: 'Перенести тренировку',
  VIEW_PROGRAM: 'Открыть программу',
  CHOOSE_PROGRAM: 'Выбрать программу',
  REST_DAY: 'День отдыха',
};

@Injectable()
export class DashboardAggregationService {
  constructor(private readonly prisma: PrismaClient, private readonly priority: DashboardPriorityService, private readonly tz: DashboardTimezoneService) {}

  async aggregate(userId: string, timezone: string, locale: string, now = new Date()) {
    const boundaries = this.tz.boundaries(now, timezone);
    const weekEnd = new Date(boundaries.weekStart.getTime() + 7 * 86400000);
    const [user, active, today, missed, next, assignment, completedWeek, completedAll, last, notification, draft] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } }),
      this.prisma.workout.findMany({ where: { userId, status: { in: ['IN_PROGRESS', 'PAUSED'] } }, orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }], take: 2, include: { sessions: true, exercises: { include: { sets: true }, orderBy: { position: 'asc' } } } }),
      this.prisma.workout.findMany({ where: { userId, scheduledFor: { gte: boundaries.start, lt: boundaries.end }, status: 'PLANNED' }, orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }], take: 4, include: { programAssignment: { include: { program: true } } } }),
      this.prisma.workout.findMany({ where: { userId, scheduledFor: { lt: boundaries.start }, status: 'MISSED', programAssignment: { rescheduleMissedWorkouts: true } }, orderBy: { scheduledFor: 'desc' }, take: 1, include: { programAssignment: { include: { program: true } } } }),
      this.prisma.workout.findFirst({ where: { userId, scheduledFor: { gte: boundaries.end }, status: 'PLANNED' }, orderBy: { scheduledFor: 'asc' }, include: { exercises: { select: { id: true } }, programAssignment: { include: { program: true } } } }),
      this.prisma.userProgramAssignment.findFirst({ where: { userId, status: 'ACTIVE' }, orderBy: { startedAt: 'desc' }, include: { program: true } }),
      this.prisma.workout.findMany({ where: { userId, status: 'COMPLETED', completedAt: { gte: boundaries.weekStart, lt: weekEnd } }, orderBy: { completedAt: 'desc' }, include: { exercises: { include: { sets: true } } } }),
      this.prisma.workout.findMany({ where: { userId, status: 'COMPLETED', completedAt: { not: null } }, orderBy: { completedAt: 'desc' }, select: { completedAt: true } }),
      this.prisma.workout.findFirst({ where: { userId, status: 'COMPLETED' }, orderBy: { completedAt: 'desc' }, include: { sessions: true, exercises: { include: { sets: true } } } }),
      this.prisma.notification.findFirst({ where: { userId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } }),
      this.prisma.onboardingDraft.findFirst({ where: { userId, status: 'IN_PROGRESS' }, orderBy: { updatedAt: 'desc' } }),
    ]);
    if (!user) return null;

    const onboarding = !user.profile?.onboardingCompleted;
    const hasProgram = !!assignment;
    const action = active.length
      ? { type: 'RESUME_WORKOUT' as const, priority: 1 }
      : this.priority.resolve({ active: false, onboarding, planned: today.length > 0, missed: missed.length > 0, program: hasProgram, noAction: hasProgram && !today.length && !missed.length });
    const primary = active[0] ?? today[0] ?? missed[0];
    const completedToday = completedWeek.filter(workout => workout.completedAt && workout.completedAt >= boundaries.start && workout.completedAt < boundaries.end).length;
    const activeProgress = active[0] ? this.workoutProgress(active[0]) : null;
    const completedVolume = completedWeek.reduce((total, workout) => total + this.volume(workout.exercises), 0);
    const activeDays = new Set(completedWeek.filter(w => w.completedAt).map(w => this.tz.localDate(w.completedAt!, timezone))).size;
    const streak = this.streak(completedAll.map(item => item.completedAt!).filter(Boolean), timezone, boundaries.weekStart);
    const primaryState = active.length ? active[0].status : action.type;
    const primaryLink = active.length ? `/workouts/${active[0].id}` : onboarding ? '/onboarding' : primary ? `/workouts/${primary.id}` : assignment ? `/programs/${assignment.programId}` : '/programs';

    return {
      meta: { generatedAt: now.toISOString(), localDate: boundaries.localDate, timezone, locale, snapshotVersion: 1, algorithmVersion: 'dashboard-v1', cache: { hit: false, expiresAt: new Date(now.getTime() + 300000).toISOString() } },
      user: { id: user.id, displayName: [user.firstName, user.lastName].filter(Boolean).join(' '), avatarUrl: user.telegramPhotoUrl, onboardingCompleted: !!user.profile?.onboardingCompleted },
      greeting: { title: onboarding ? 'Добро пожаловать' : `Доброе утро, ${user.firstName}`, subtitle: onboarding ? 'Ответьте на несколько вопросов — подберём стартовую программу.' : 'Сегодня можно сделать ещё один шаг к цели.' },
      primaryAction: { type: action.type, priority: action.priority, title: ACTION_TITLES[action.type], description: primary?.title ?? null, label: action.type === 'REST_DAY' ? 'Подробнее' : action.type === 'RESCHEDULE_WORKOUT' ? 'Перенести' : 'Продолжить', deepLink: primaryLink, workoutId: primary?.id ?? null, programId: assignment?.programId ?? null, state: primaryState, scheduledFor: primary?.scheduledFor?.toISOString() ?? null, startedAt: active[0]?.startedAt?.toISOString() ?? null, progress: activeProgress },
      today: { state: active.length ? 'WORKOUT_IN_PROGRESS' : onboarding ? 'ONBOARDING_REQUIRED' : today.length ? 'WORKOUT_PLANNED' : missed.length ? 'WORKOUT_MISSED' : assignment ? 'REST_DAY' : 'PROGRAM_REQUIRED', label: ACTION_TITLES[action.type], completedWorkoutCount: completedToday, plannedWorkoutCount: today.length, restDay: !active.length && !today.length && !missed.length && !!assignment, secondaryActions: [] },
      nextWorkout: next ? this.workoutResponse(next, timezone) : null,
      activeProgram: assignment ? { id: assignment.programId, title: assignment.program.title, goal: this.first(assignment.program.goals), level: this.first(assignment.program.levels), status: assignment.status, startedAt: assignment.startedAt.toISOString(), weekNumber: this.weekNumber(assignment.startedAt, now, timezone), totalWeeks: null, completedWorkouts: null, plannedWorkouts: null, progressPercent: null, deepLink: `/programs/${assignment.programId}` } : null,
      progress: { weekly: { completedWorkouts: completedWeek.length, targetWorkouts: user.profile?.trainingFrequency ?? null, volumeKg: completedVolume || null, activeDays }, streak, lastWorkout: last ? { id: last.id, title: last.title, completedAt: last.completedAt?.toISOString() ?? null, durationMinutes: this.durationMinutes(last), volumeKg: this.volume(last.exercises) || null, deepLink: `/history/workouts/${last.id}` } : null },
      reminders: { enabled: !!notification, nextReminderAt: null, timezone, deepLink: '/profile/reminders' },
      onboarding: { required: onboarding, currentStep: draft?.currentStep ?? null, progressPercent: onboarding ? Math.round((Array.isArray(draft?.completedSteps) ? (draft.completedSteps as unknown[]).length / 9 : 0) * 100) : 100, deepLink: onboarding ? '/onboarding' : null },
      quickLinks: [{ type: 'START_WORKOUT', title: 'Тренировки', deepLink: '/workouts' }, { type: 'PROGRAMS', title: 'Программы', deepLink: '/programs' }, { type: 'PROGRESS', title: 'Прогресс', deepLink: '/progress' }, { type: 'PROFILE', title: 'Профиль', deepLink: '/profile' }],
    };
  }

  private first(value: unknown) { return Array.isArray(value) && value.length ? value[0] : null; }
  private volume(exercises: Array<{ kind: WorkoutExerciseKind; sets: Array<{ status: string; reps: number | null; weightKg: unknown; actualReps?: number | null; actualWeightKg?: unknown }> }>) { return exercises.filter(exercise => exercise.kind === 'STRENGTH').reduce((total, exercise) => total + exercise.sets.filter(set => set.status === 'COMPLETED').reduce((subtotal, set) => { const reps = set.actualReps ?? set.reps; const weight = set.actualWeightKg ?? set.weightKg; return reps != null && weight != null ? subtotal + Number(weight) * reps : subtotal; }, 0), 0); }
  private workoutProgress(workout: { exercises: Array<{ completedAt: Date | null; sets: Array<{ status: string }> }> }) { const totalExercises = workout.exercises.length; const completedExercises = workout.exercises.filter(exercise => exercise.completedAt).length; const totalSets = workout.exercises.reduce((total, exercise) => total + exercise.sets.length, 0); const completedSets = workout.exercises.reduce((total, exercise) => total + exercise.sets.filter(set => set.status === 'COMPLETED').length, 0); return { completedExercises, totalExercises, completedSets, totalSets, percent: totalSets ? Math.round(completedSets / totalSets * 100) : totalExercises ? Math.round(completedExercises / totalExercises * 100) : 0 }; }
  private durationMinutes(workout: { sessions: Array<{ durationSeconds: number | null }>; startedAt: Date | null; completedAt: Date | null }) { const seconds = workout.sessions.find(session => session.durationSeconds != null)?.durationSeconds ?? (workout.startedAt && workout.completedAt ? Math.max(0, workout.completedAt.getTime() - workout.startedAt.getTime()) / 1000 : null); return seconds == null ? null : Math.round(seconds / 60); }
  private workoutResponse(workout: any, timezone: string) { return { id: workout.id, title: workout.title, status: workout.status, scheduledFor: workout.scheduledFor.toISOString(), localScheduledDate: this.tz.localDate(workout.scheduledFor, timezone), programId: workout.programAssignment.programId, programTitle: workout.programAssignment.program.title, estimatedDurationMinutes: workout.estimatedDurationMinutes ?? workout.programAssignment.program.durationMinutes ?? null, exerciseCount: workout.exercises?.length ?? null, deepLink: `/workouts/${workout.id}` }; }
  private weekNumber(startedAt: Date, now: Date, timezone: string) { const start = this.tz.localDate(startedAt, timezone); const current = this.tz.localDate(now, timezone); return Math.max(1, Math.floor((Date.parse(`${current}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 604800000) + 1); }
  private streak(dates: Date[], timezone: string, currentWeek: Date) { const weeks = new Set(dates.map(date => { const parts = this.tz.parts(date, timezone); const day = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`); day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); return day.toISOString().slice(0, 10); })); let cursor = currentWeek.toISOString().slice(0, 10); let currentWeeks = 0; while (weeks.has(cursor)) { currentWeeks += 1; const date = new Date(`${cursor}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 7); cursor = date.toISOString().slice(0, 10); } return { currentWeeks, bestWeeks: this.bestStreak(weeks) }; }
  private bestStreak(weeks: Set<string>) { const sorted = [...weeks].sort(); let best = 0; let run = 0; let previous: Date | null = null; for (const value of sorted) { const date = new Date(`${value}T00:00:00Z`); if (previous && date.getTime() - previous.getTime() === 604800000) run += 1; else run = 1; best = Math.max(best, run); previous = date; } return best; }
}
