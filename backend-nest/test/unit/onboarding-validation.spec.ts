import { OnboardingValidationService } from '../../src/onboarding/onboarding-validation.service';
import { OnboardingStepDto } from '../../src/onboarding/dto/onboarding.dto';

describe('OnboardingValidationService', () => {
  const service = new OnboardingValidationService();

  it('rejects a later step when a prior mandatory step is incomplete', () => {
    expect(() => service.validateStep(OnboardingStepDto.EQUIPMENT, { equipment: ['DUMBBELLS'] }, {})).toThrow();
  });

  it('accepts the required goal fields on the goal step', () => {
    expect(service.validateStep(OnboardingStepDto.GOAL, { fitnessGoal: 'WEIGHT_LOSS' as any }, {})).toMatchObject({ fitnessGoal: 'WEIGHT_LOSS' });
  });

  it('requires all mandatory fields before completion', () => {
    expect(() => service.validateComplete({ fitnessGoal: 'WEIGHT_LOSS' })).toThrow();
  });

  it('rejects values outside controlled equipment and preference dictionaries', () => {
    expect(() => service.validateStep(OnboardingStepDto.EQUIPMENT, { equipment: ['UNKNOWN'] }, { fitnessGoal: 'WEIGHT_LOSS', trainingLocation: 'HOME', trainingFrequency: 3, preferredWorkoutDuration: 30, experienceLevel: 'BEGINNER' })).toThrow();
  });

  it('requires body data before completion', () => {
    expect(() => service.validateComplete({
      fitnessGoal: 'WEIGHT_LOSS', trainingLocation: 'HOME', trainingFrequency: 3,
      preferredWorkoutDuration: 30, experienceLevel: 'BEGINNER', equipment: ['BODYWEIGHT'],
      nutritionPlanNeeded: false,
    })).toThrow();
  });

  it('rejects partially configured reminder schedules', () => {
    expect(() => service.validateComplete({
      fitnessGoal: 'WEIGHT_LOSS', trainingLocation: 'HOME', trainingFrequency: 3,
      preferredWorkoutDuration: 30, experienceLevel: 'BEGINNER', birthDate: '1990-01-01',
      heightCm: 180, weightKg: 80, equipment: ['BODYWEIGHT'], nutritionPlanNeeded: false,
      notificationDays: [1], notificationTime: '09:00',
    })).toThrow();
  });
});
