import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaClient, UserStatus } from '@prisma/client';
import { OnboardingAnalyticsService } from './onboarding-analytics.service';
import { OnboardingValidationService } from './onboarding-validation.service';
import { OnboardingStepDto, UpdateOnboardingDraftDto } from './dto/onboarding.dto';

@Injectable()
export class OnboardingDraftService {
  constructor(private readonly prisma: PrismaClient, private readonly validation: OnboardingValidationService, private readonly analytics: OnboardingAnalyticsService) {}

  async getOrCreate(userId: string) {
    await this.assertActive(userId);
    const existing = await this.prisma.onboardingDraft.findFirst({ where: { userId, status: 'IN_PROGRESS' } });
    if (existing) return existing;
    let draft;
    try {
      draft = await this.prisma.onboardingDraft.create({ data: { userId, expiresAt: new Date(Date.now() + 30 * 86400000) } });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      draft = await this.prisma.onboardingDraft.findFirstOrThrow({ where: { userId, status: 'IN_PROGRESS' } });
    }
    this.analytics.event('onboarding.started', { userId, draftId: draft.id });
    return draft;
  }

  async update(userId: string, dto: UpdateOnboardingDraftDto) {
    await this.assertActive(userId);
    const draft = await this.getOrCreate(userId);
    if (draft.version !== dto.version) {
      this.analytics.event('onboarding.draft.conflict', { userId, draftId: draft.id });
      throw new ConflictException({ code: 'ONBOARDING_DRAFT_CONFLICT', message: 'Draft version is stale', details: { version: draft.version, data: draft.draftData } });
    }
    const data = this.validation.validateStep(dto.currentStep, dto.data, draft.draftData as Record<string, unknown>);
    const completed = new Set((draft.completedSteps as string[]) || []);
    for (const step of this.completedStepsThrough(dto.currentStep)) completed.add(step);
    const updatedRows = await this.prisma.onboardingDraft.updateMany({ where: { id: draft.id, version: dto.version, status: 'IN_PROGRESS' }, data: { draftData: data as any, currentStep: this.nextStep(dto.currentStep), completedSteps: [...completed], version: { increment: 1 }, expiresAt: new Date(Date.now() + 30 * 86400000) } });
    if (updatedRows.count !== 1) {
      const current = await this.prisma.onboardingDraft.findUniqueOrThrow({ where: { id: draft.id } });
      throw new ConflictException({ code: 'ONBOARDING_DRAFT_CONFLICT', message: 'Draft version is stale', details: { version: current.version, data: current.draftData } });
    }
    const updated = await this.prisma.onboardingDraft.findUniqueOrThrow({ where: { id: draft.id } });
    this.analytics.event('onboarding.step.saved', { userId, draftId: draft.id, step: dto.currentStep });
    return updated;
  }

  private completedStepsThrough(step: OnboardingStepDto) { return Object.values(OnboardingStepDto).slice(0, Object.values(OnboardingStepDto).indexOf(step) + 1); }
  private nextStep(step: OnboardingStepDto) { const i = Object.values(OnboardingStepDto).indexOf(step); return Object.values(OnboardingStepDto)[Math.min(i + 1, Object.values(OnboardingStepDto).length - 1)] as any; }
  private async assertActive(userId: string) { const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } }); if (!user || user.status !== UserStatus.ACTIVE) throw new ForbiddenException({ code: 'ACCOUNT_DELETED', message: 'Account deleted or blocked' }); }
}
