import { DashboardPriorityService } from './dashboard-priority.service';

describe('DashboardPriorityService', () => {
  const service = new DashboardPriorityService();
  const base = { active: false, onboarding: false, planned: false, missed: false, program: false };
  it.each([
    ['RESUME_WORKOUT', { active: true }, 1],
    ['CONTINUE_ONBOARDING', { onboarding: true }, 2],
    ['START_WORKOUT', { planned: true }, 3],
    ['RESCHEDULE_WORKOUT', { missed: true }, 4],
    ['VIEW_PROGRAM', { program: true }, 5],
    ['CHOOSE_PROGRAM', {}, 6],
    ['REST_DAY', { noAction: true }, 7],
  ])('resolves %s', (type, input, priority) => {
    expect(service.resolve({ ...base, ...input } as any)).toEqual({ type, priority });
  });
  it('always prefers an unfinished workout', () => {
    expect(service.resolve({ active: true, onboarding: true, planned: true, missed: true, program: true })).toEqual({ type: 'RESUME_WORKOUT', priority: 1 });
  });
});
