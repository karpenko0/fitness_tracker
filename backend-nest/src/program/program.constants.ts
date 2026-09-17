export const MUSCLE_GROUPS = [
  'CHEST', 'BACK', 'LATS', 'TRAPEZIUS', 'SHOULDERS_FRONT', 'SHOULDERS_SIDE', 'SHOULDERS_REAR',
  'BICEPS', 'TRICEPS', 'FOREARMS', 'CORE', 'LOWER_BACK', 'GLUTES', 'QUADRICEPS', 'HAMSTRINGS',
  'CALVES', 'ADDUCTORS', 'ABDUCTORS',
] as const;

export const EQUIPMENT_TYPES = [
  'BODYWEIGHT', 'BARBELL', 'DUMBBELLS', 'KETTLEBELL', 'CABLE_MACHINE', 'MACHINES', 'BENCH',
  'PULL_UP_BAR', 'RESISTANCE_BANDS', 'MEDICINE_BALL', 'CARDIO_MACHINE', 'OTHER',
] as const;

export const CONTRAINDICATION_TAGS = [
  'SHOULDER_DISCOMFORT', 'LOWER_BACK_DISCOMFORT', 'KNEE_DISCOMFORT', 'WRIST_DISCOMFORT',
  'HIP_DISCOMFORT', 'NECK_DISCOMFORT', 'BALANCE_LIMITATION',
] as const;

export type MuscleGroup = typeof MUSCLE_GROUPS[number];
export type EquipmentType = typeof EQUIPMENT_TYPES[number];
export type ContraindicationTag = typeof CONTRAINDICATION_TAGS[number];

export const FREE_LIMITS = {
  maxActiveCustomPrograms: 1,
  maxDraftCustomPrograms: 2,
  maxCustomExercises: 10,
  historyDays: 30,
};

export const PRO_LIMITS = {
  maxActiveCustomPrograms: 10_000,
  maxDraftCustomPrograms: 10_000,
  maxCustomExercises: 10_000,
  historyDays: 3650,
};
