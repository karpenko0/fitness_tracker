import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { OnboardingStepDto, OnboardingDataDto } from './dto/onboarding.dto';

const requiredByStep: Record<OnboardingStepDto, string[]> = {
  GOAL: ['fitnessGoal'], TRAINING_CONTEXT: ['trainingLocation', 'trainingFrequency', 'preferredWorkoutDuration'],
  EXPERIENCE: ['experienceLevel'], BODY_DATA: ['birthDate', 'heightCm', 'weightKg'], EQUIPMENT: ['equipment'], LIMITATIONS: [],
  REMINDERS: [], NUTRITION: ['nutritionPlanNeeded'], REVIEW: [],
};
const order = Object.values(OnboardingStepDto);

@Injectable()
export class OnboardingValidationService {
  validateStep(step: OnboardingStepDto, data: OnboardingDataDto, existing: Record<string, unknown>) {
    const merged = { ...existing, ...data } as Record<string, unknown>;
    const allowedEquipment = new Set(['BODYWEIGHT', 'DUMBBELLS', 'BARBELL', 'KETTLEBELL', 'RESISTANCE_BANDS']);
    const allowedPreferences = new Set(['STRENGTH', 'CARDIO', 'MOBILITY', 'LOW_IMPACT']);
    if (Array.isArray(merged.equipment) && merged.equipment.some(value => !allowedEquipment.has(String(value)))) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown equipment value' });
    if (Array.isArray(merged.trainingPreferences) && merged.trainingPreferences.some(value => !allowedPreferences.has(String(value)))) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Unknown training preference value' });
    const reminderFields = ['notificationDays', 'notificationTime', 'timezone'];
    const reminderValues = reminderFields.map(field => merged[field]);
    if (reminderValues.some(value => value !== undefined && value !== null) && reminderValues.some(value => value === undefined || value === null || (Array.isArray(value) && value.length === 0))) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Reminder schedule must be complete', details: reminderFields.map(field => ({ field })) });
    }
    const index = order.indexOf(step);
    for (const previous of order.slice(0, index)) {
      for (const field of requiredByStep[previous]) {
        if (merged[field] === undefined || merged[field] === null || (Array.isArray(merged[field]) && merged[field].length === 0)) {
          throw new UnprocessableEntityException({ code: 'ONBOARDING_STEP_DEPENDENCY_ERROR', message: `Complete ${previous} before continuing`, details: [{ field }] });
        }
      }
    }
    for (const field of requiredByStep[step]) {
      if (merged[field] === undefined || merged[field] === null || (Array.isArray(merged[field]) && merged[field].length === 0)) {
          throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Required onboarding data is missing', details: [{ field }] });
      }
    }
    return merged;
  }

  validateComplete(data: Record<string, unknown>) {
    return this.validateStep(OnboardingStepDto.REVIEW, {} as OnboardingDataDto, data);
  }
}
