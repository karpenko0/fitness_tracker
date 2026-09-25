import { HabitValidationService, HabitGoalSpec } from './habit-validation.service';

describe('HabitValidationService', () => {
  const service = new HabitValidationService();

  const base = (overrides: Partial<HabitGoalSpec> = {}): HabitGoalSpec => ({
    title: 'Пить воду',
    type: 'WATER',
    goalType: 'COUNT',
    goalValue: 2000,
    unit: 'ML',
    schedule: 'DAILY',
    timezone: 'Europe/Moscow',
    ...overrides,
  });

  const expectValidationError = (spec: HabitGoalSpec, field?: string) => {
    try {
      service.validate(spec);
      fail('expected VALIDATION_ERROR to be thrown');
    } catch (error: any) {
      expect(error.response.code).toBe('VALIDATION_ERROR');
      if (field) {
        expect(error.response.details?.[0]?.field ?? error.response.details).toBeDefined();
      }
    }
  };

  it('accepts a valid WATER habit in milliliters', () => {
    expect(() => service.validate(base())).not.toThrow();
  });

  it('accepts a valid MEDICATION habit with BOOLEAN goal', () => {
    expect(() => service.validate(base({ type: 'MEDICATION', goalType: 'BOOLEAN', goalValue: null, unit: null }))).not.toThrow();
  });

  it('rejects MEDICATION habit with COUNT goal', () => {
    expectValidationError(base({ type: 'MEDICATION', goalType: 'COUNT', goalValue: 1, unit: 'TIMES' }), 'goalType');
  });

  it('rejects MEDICATION habit without goal', () => {
    expectValidationError(base({ type: 'MEDICATION', goalType: undefined as any, goalValue: null, unit: null }));
  });

  it('accepts STEPS habit with COUNT goal and STEPS unit', () => {
    expect(() => service.validate(base({ type: 'STEPS', goalValue: 10000, unit: 'STEPS' }))).not.toThrow();
  });

  it('rejects STEPS habit with wrong unit', () => {
    expectValidationError(base({ type: 'STEPS', goalValue: 10000, unit: 'ML' }), 'unit');
  });

  it('rejects STEPS habit with BOOLEAN goal', () => {
    expectValidationError(base({ type: 'STEPS', goalType: 'BOOLEAN', goalValue: null, unit: 'STEPS' }), 'goalType');
  });

  it('rejects WATER habit not measured in milliliters', () => {
    expectValidationError(base({ unit: 'GRAMS' }), 'unit');
  });

  it('rejects habit without title', () => {
    expectValidationError(base({ title: '   ' }), 'title');
  });

  it('rejects habit without timezone', () => {
    expectValidationError(base({ timezone: '' }), 'timezone');
  });

  it('rejects habit with unknown timezone', () => {
    expectValidationError(base({ timezone: 'Mars/Olympus' }), 'timezone');
  });

  it('rejects COUNT goal without goalValue', () => {
    expectValidationError(base({ goalValue: null as any }), 'goalValue');
  });

  it('rejects zero and negative goalValue', () => {
    expectValidationError(base({ goalValue: 0 }), 'goalValue');
    expectValidationError(base({ goalValue: -250 }), 'goalValue');
  });

  it('rejects BOOLEAN goal with numeric value', () => {
    expectValidationError(base({ type: 'MEDICATION', goalType: 'BOOLEAN', goalValue: 1, unit: null }), 'goalValue');
  });

  it('rejects COUNT goal without unit', () => {
    expectValidationError(base({ type: 'CUSTOM', unit: null as any }), 'unit');
  });

  it('accepts WEEKDAYS schedule with valid days', () => {
    expect(() => service.validate(base({ schedule: 'WEEKDAYS', weekdays: [1, 3, 5] }))).not.toThrow();
  });

  it('rejects WEEKDAYS schedule without days', () => {
    expectValidationError(base({ schedule: 'WEEKDAYS', weekdays: [] }), 'weekdays');
  });

  it('rejects WEEKDAYS schedule with out-of-range days', () => {
    expectValidationError(base({ schedule: 'WEEKDAYS', weekdays: [0, 8] }), 'weekdays');
  });

  it('rejects ONE_TIME schedule without date', () => {
    expectValidationError(base({ schedule: 'ONE_TIME' }), 'oneTimeDate');
  });

  it('accepts ONE_TIME schedule with date', () => {
    expect(() => service.validate(base({ schedule: 'ONE_TIME', oneTimeDate: '2026-10-01' }))).not.toThrow();
  });

  it('rejects invalid reminder time', () => {
    expectValidationError(base({ reminderTime: '25:00' }), 'reminderTime');
    expectValidationError(base({ reminderTime: '9:30' }), 'reminderTime');
  });

  it('accepts valid reminder time', () => {
    expect(() => service.validate(base({ reminderTime: '09:30' }))).not.toThrow();
  });

  describe('normalize', () => {
    it('trims title, sorts weekdays, clears goal for BOOLEAN', () => {
      const normalized = service.normalize({
        title: '  Растяжка  ',
        type: 'STRETCHING',
        goalType: 'BOOLEAN',
        goalValue: 5,
        unit: 'MINUTES',
        schedule: 'WEEKDAYS',
        weekdays: [5, 1, 3],
        timezone: 'UTC',
      } as any);
      expect(normalized.title).toBe('Растяжка');
      expect(normalized.weekdays).toEqual([1, 3, 5]);
      expect(normalized.goalValue).toBeNull();
      expect(normalized.unit).toBeNull();
    });

    it('keeps oneTimeDate only for ONE_TIME schedule', () => {
      const oneTime = service.normalize({ title: 't', type: 'CUSTOM', goalType: 'BOOLEAN', schedule: 'ONE_TIME', oneTimeDate: '2026-10-01', timezone: 'UTC' } as any);
      expect(oneTime.oneTimeDate).toEqual(new Date('2026-10-01'));
      const daily = service.normalize({ title: 't', type: 'CUSTOM', goalType: 'BOOLEAN', schedule: 'DAILY', oneTimeDate: '2026-10-01', timezone: 'UTC' } as any);
      expect(daily.oneTimeDate).toBeNull();
    });
  });
});
