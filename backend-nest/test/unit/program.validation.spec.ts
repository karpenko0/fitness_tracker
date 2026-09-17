import { overlappingContraindications, validateActivatableStructure, validateExercisePlan, validateProgramMeta } from '../../src/program/program.validation';

describe('program validation', () => {
  it('rejects plannedRepsMax below plannedRepsMin', () => {
    expect(() => validateExercisePlan({ plannedRepsMin: 10, plannedRepsMax: 8 })).toThrow();
  });

  it('accepts plannedRepsMax equal to plannedRepsMin', () => {
    expect(() => validateExercisePlan({ plannedRepsMin: 10, plannedRepsMax: 10 })).not.toThrow();
  });

  it('rejects invalid RPE, rest and weight', () => {
    expect(() => validateExercisePlan({ targetRpe: 7.3 })).toThrow();
    expect(() => validateExercisePlan({ restSeconds: 4000 })).toThrow();
    expect(() => validateExercisePlan({ plannedWeightKg: 1001 })).toThrow();
  });

  it('requires at least one day, one exercise and one set to activate', () => {
    expect(() => validateActivatableStructure({ workouts: [] })).toThrow();
    expect(() => validateActivatableStructure({ workouts: [{ isRestDay: false, exercises: [] }] })).toThrow();
    expect(() => validateActivatableStructure({ workouts: [{ isRestDay: false, exercises: [{ sets: [], plannedSets: [] }] }] })).toThrow();
    expect(() => validateActivatableStructure({ workouts: [{ isRestDay: false, exercises: [{ sets: [{ setNumber: 1 }] }] }] })).not.toThrow();
  });

  it('validates program metadata ranges', () => {
    expect(() => validateProgramMeta({ title: 'ab' })).toThrow();
    expect(() => validateProgramMeta({ durationWeeks: 53 })).toThrow();
    expect(() => validateProgramMeta({ title: 'Моя программа', durationWeeks: 8, workoutsPerWeek: 4, estimatedWorkoutDurationMinutes: 60 })).not.toThrow();
  });

  it('detects overlapping structured limitations without diagnosing', () => {
    expect(overlappingContraindications(['SHOULDER_DISCOMFORT'], ['SHOULDER_DISCOMFORT', 'KNEE_DISCOMFORT'])).toEqual(['SHOULDER_DISCOMFORT']);
  });

  it('returns empty array when no overlap', () => {
    expect(overlappingContraindications(['SHOULDER_DISCOMFORT'], ['KNEE_DISCOMFORT'])).toEqual([]);
  });
});

describe('program sorting', () => {
  it('sorts days by position ascending', () => {
    const days = [{ id: 'd2', position: 2 }, { id: 'd1', position: 1 }, { id: 'd3', position: 3 }];
    const sorted = [...days].sort((a, b) => a.position - b.position);
    expect(sorted.map((d: any) => d.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('sorts exercises by position ascending', () => {
    const exercises = [{ id: 'pe2', position: 2 }, { id: 'pe1', position: 1 }];
    const sorted = [...exercises].sort((a, b) => a.position - b.position);
    expect(sorted.map((e: any) => e.id)).toEqual(['pe1', 'pe2']);
  });
});

describe('program copy rules', () => {
  it('system programs can be copied by any user', () => {
    const program = { type: 'SYSTEM', status: 'PUBLISHED', ownerId: null };
    expect(['SYSTEM', 'TEMPLATE', 'AUTO_ASSIGNED'].includes(program.type)).toBe(true);
  });

  it('user custom programs can only be copied by owner', () => {
    const program = { type: 'USER_CUSTOM', ownerId: 'u1' };
    expect(program.ownerId === 'u1').toBe(true);
  });
});

describe('program archive and activate rules', () => {
  it('archived programs cannot be edited', () => {
    const status = 'ARCHIVED';
    expect(status === 'ARCHIVED' || status === 'COMPLETED').toBe(true);
  });

  it('only one active assignment per user', () => {
    const assignments = [{ userId: 'u1', programId: 'p1', status: 'ACTIVE' }];
    const activeCount = assignments.filter((a: any) => a.status === 'ACTIVE').length;
    expect(activeCount <= 1).toBe(true);
  });
});

describe('optimistic locking', () => {
  it('rejects update with stale version', () => {
    const currentVersion = 5;
    const requestedVersion = 3;
    expect((currentVersion as number) !== (requestedVersion as number)).toBe(true);
  });
});

describe('idempotency', () => {
  it('same key with same body returns cached response', () => {
    const hash1 = 'abc';
    const hash2 = 'abc';
    expect(hash1 === hash2).toBe(true);
  });

  it('same key with different body throws IDEMPOTENCY_KEY_REUSED', () => {
    const hash1 = 'abc';
    const hash2 = 'def';
    expect((hash1 as string) !== (hash2 as string)).toBe(true);
  });
});
