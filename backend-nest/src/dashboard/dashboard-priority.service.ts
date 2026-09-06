import { Injectable } from '@nestjs/common';

export type DashboardAction = 'RESUME_WORKOUT' | 'CONTINUE_ONBOARDING' | 'START_WORKOUT' | 'RESCHEDULE_WORKOUT' | 'VIEW_PROGRAM' | 'CHOOSE_PROGRAM' | 'REST_DAY';
export interface PriorityInput { active: boolean; onboarding: boolean; planned: boolean; missed: boolean; program: boolean; noAction?: boolean; }

@Injectable()
export class DashboardPriorityService {
  resolve(input: PriorityInput): { type: DashboardAction; priority: number } {
    if (input.active) return { type: 'RESUME_WORKOUT', priority: 1 };
    if (input.onboarding) return { type: 'CONTINUE_ONBOARDING', priority: 2 };
    if (input.planned) return { type: 'START_WORKOUT', priority: 3 };
    if (input.missed) return { type: 'RESCHEDULE_WORKOUT', priority: 4 };
    if (input.program) return { type: 'VIEW_PROGRAM', priority: 5 };
    if (input.noAction) return { type: 'REST_DAY', priority: 7 };
    return { type: 'CHOOSE_PROGRAM', priority: 6 };
  }
}
