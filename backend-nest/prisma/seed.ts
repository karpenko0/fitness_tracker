import { execSync } from 'child_process';
import 'dotenv/config';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn('DATABASE_URL is not set — skipping seed. Set DATABASE_URL to run seeding.');
    return;
  }

  // Ensure Prisma client is generated and import it dynamically so we can run
  // `prisma generate` in-process if necessary.
  let PrismaClient: any;
  try {
    const pkg = await import('@prisma/client');
    PrismaClient = pkg.PrismaClient;
  } catch (e: any) {
    console.log('Prisma client not found — running `npx prisma generate`...');
    execSync('npx prisma generate', { stdio: 'inherit' });
    const pkg2 = await import('@prisma/client');
    PrismaClient = pkg2.PrismaClient;
  }

  const prisma = new PrismaClient();

  const roles = [
    { code: 'USER', name: 'User', description: 'Standard mobile app user' },
    { code: 'TRAINER', name: 'Trainer', description: 'Trainer who assigns programs to users' },
    { code: 'CONTENT_MANAGER', name: 'Content Manager', description: 'Content manager with access to content workflows' },
    { code: 'ADMIN', name: 'Admin', description: 'Administrative user with system access' },
    { code: 'SUPER_ADMIN', name: 'Super Admin', description: 'Full system access with role management' },
    { code: 'SYSTEM', name: 'System', description: 'Internal system account for automated operations' },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: role,
    });
  }

  const programs = [
    { id: '00000000-0000-4000-8000-000000000001', title: 'Новичок: домашняя база', description: 'Базовая программа с минимальным оборудованием', type: 'SYSTEM', goal: 'HEALTH', level: 'BEGINNER', location: 'HOME', goals: ['HEALTH', 'MAINTENANCE'], levels: ['BEGINNER'], locations: ['HOME', 'MIXED'], durationWeeks: 4, workoutsPerWeek: 3, durationMinutes: 30, estimatedWorkoutDurationMinutes: 30, requiredEquipment: ['BODYWEIGHT'], firstWorkoutTitle: 'Тренировка 1: базовая', isFallback: true, isProOnly: false },
    { id: '00000000-0000-4000-8000-000000000002', title: 'Снижение веса: домашние тренировки', description: 'Домашняя программа для снижения веса', type: 'SYSTEM', goal: 'WEIGHT_LOSS', level: 'BEGINNER', location: 'HOME', goals: ['WEIGHT_LOSS'], levels: ['BEGINNER', 'INTERMEDIATE'], locations: ['HOME'], durationWeeks: 8, workoutsPerWeek: 3, durationMinutes: 30, estimatedWorkoutDurationMinutes: 30, requiredEquipment: ['BODYWEIGHT'], firstWorkoutTitle: 'Тренировка 1: всё тело', isFallback: false, isProOnly: false },
    { id: '00000000-0000-4000-8000-000000000003', title: 'Сила: зал', description: 'Силовая программа для зала', type: 'SYSTEM', goal: 'STRENGTH', level: 'INTERMEDIATE', location: 'GYM', goals: ['STRENGTH', 'MUSCLE_GAIN'], levels: ['INTERMEDIATE', 'ADVANCED'], locations: ['GYM'], durationWeeks: 8, workoutsPerWeek: 4, durationMinutes: 60, estimatedWorkoutDurationMinutes: 60, requiredEquipment: ['BARBELL', 'DUMBBELLS'], firstWorkoutTitle: 'Тренировка 1: верх тела', isFallback: false, isProOnly: false },
    { id: '00000000-0000-4000-8000-000000000004', title: 'Pro гипертрофия', description: 'Расширенная программа для Pro', type: 'SYSTEM', goal: 'MUSCLE_GAIN', level: 'ADVANCED', location: 'GYM', goals: ['MUSCLE_GAIN'], levels: ['ADVANCED'], locations: ['GYM'], durationWeeks: 12, workoutsPerWeek: 5, durationMinutes: 75, estimatedWorkoutDurationMinutes: 75, requiredEquipment: ['BARBELL', 'DUMBBELLS', 'BENCH'], firstWorkoutTitle: 'День 1: грудь и трицепс', isFallback: false, isProOnly: true },
  ];
  for (const program of programs) {
    await prisma.starterProgram.upsert({ where: { id: program.id }, update: { ...program, status: 'PUBLISHED', active: true }, create: { ...program, status: 'PUBLISHED', active: true } });
  }

  const exercises = [
    { id: '10000000-0000-4000-8000-000000000001', slug: 'barbell-squat', title: 'Присед со штангой', description: 'Базовое упражнение для ног', muscleGroup: 'Ноги', movementType: 'SQUAT', equipment: 'BARBELL', equipmentList: ['BARBELL'], primaryMuscles: ['QUADRICEPS', 'GLUTES'], secondaryMuscles: ['HAMSTRINGS', 'CORE'], difficulty: 'INTERMEDIATE', exerciseType: 'STRENGTH', instructions: [{ step: 1, text: 'Поставьте штангу на верх трапеций и снимите её со стоек.' }, { step: 2, text: 'Присядьте до параллели бедра полу, сохраняя нейтральную спину.' }], safetyNotes: 'Используйте комфортную глубину и контролируйте колени.', contraindications: ['KNEE_DISCOMFORT', 'LOWER_BACK_DISCOMFORT'] },
    { id: '10000000-0000-4000-8000-000000000002', slug: 'barbell-bench-press', title: 'Жим штанги лёжа', description: 'Базовое жимовое упражнение', muscleGroup: 'Грудь', movementType: 'PUSH', equipment: 'BARBELL', equipmentList: ['BARBELL', 'BENCH'], primaryMuscles: ['CHEST'], secondaryMuscles: ['TRICEPS', 'SHOULDERS_FRONT'], difficulty: 'INTERMEDIATE', exerciseType: 'STRENGTH', instructions: [{ step: 1, text: 'Лягте на скамью и устойчиво поставьте стопы на пол.' }, { step: 2, text: 'Опустите штангу к груди и выжмите вверх.' }], safetyNotes: 'Используйте комфортную амплитуду движения.', contraindications: ['SHOULDER_DISCOMFORT'], media: [{ type: 'IMAGE', url: 'https://cdn.example.com/exercises/bench-press.jpg' }], alternativeExerciseIds: ['10000000-0000-4000-8000-000000000004'] },
    { id: '10000000-0000-4000-8000-000000000003', slug: 'dumbbell-row', title: 'Тяга гантели в наклоне', description: 'Тяговое упражнение для спины', muscleGroup: 'Спина', movementType: 'PULL', equipment: 'DUMBBELLS', equipmentList: ['DUMBBELLS', 'BENCH'], primaryMuscles: ['BACK', 'LATS'], secondaryMuscles: ['BICEPS'], difficulty: 'BEGINNER', exerciseType: 'STRENGTH', instructions: [{ step: 1, text: 'Обопритесь одной рукой о скамью и подтяните гантель к поясу.' }], safetyNotes: 'Не вращайте корпус.', contraindications: ['LOWER_BACK_DISCOMFORT'] },
    { id: '10000000-0000-4000-8000-000000000004', slug: 'dumbbell-bench-press', title: 'Жим гантелей лёжа', description: 'Альтернатива жиму штанги', muscleGroup: 'Грудь', movementType: 'PUSH', equipment: 'DUMBBELLS', equipmentList: ['DUMBBELLS', 'BENCH'], primaryMuscles: ['CHEST'], secondaryMuscles: ['TRICEPS', 'SHOULDERS_FRONT'], difficulty: 'BEGINNER', exerciseType: 'STRENGTH', instructions: [{ step: 1, text: 'Лягте на скамью и выжмите гантели вверх.' }], safetyNotes: 'Контролируйте гантели в нижней точке.', contraindications: ['SHOULDER_DISCOMFORT'] },
    { id: '10000000-0000-4000-8000-000000000005', slug: 'bodyweight-squat', title: 'Приседания с весом тела', description: 'Базовое домашнее упражнение', muscleGroup: 'Ноги', movementType: 'SQUAT', equipment: 'BODYWEIGHT', equipmentList: ['BODYWEIGHT'], primaryMuscles: ['QUADRICEPS', 'GLUTES'], secondaryMuscles: ['CORE'], difficulty: 'BEGINNER', exerciseType: 'BODYWEIGHT', instructions: [{ step: 1, text: 'Присядьте до комфортной глубины, сохраняя пятки на полу.' }], safetyNotes: 'Не округляйте поясницу.', contraindications: ['KNEE_DISCOMFORT'] },
  ];
  for (const exercise of exercises) await prisma.exerciseCatalogItem.upsert({ where: { id: exercise.id }, update: exercise, create: exercise });
  await prisma.exerciseAlternative.deleteMany({ where: { exerciseId: exercises[1].id } });
  await prisma.exerciseAlternative.create({ data: { exerciseId: exercises[1].id, alternativeExerciseId: exercises[3].id } });

  const strengthProgramWorkout = await prisma.programWorkout.upsert({ where: { programId_position: { programId: programs[2].id, position: 1 } }, update: { title: programs[2].firstWorkoutTitle }, create: { programId: programs[2].id, title: programs[2].firstWorkoutTitle, position: 1 } });
  await prisma.programWorkoutExercise.upsert({ where: { programWorkoutId_position: { programWorkoutId: strengthProgramWorkout.id, position: 1 } }, update: { exerciseId: exercises[1].id, plannedSets: [{ reps: 8, weightKg: 60, restSeconds: 120 }, { reps: 8, weightKg: 60, restSeconds: 120 }] }, create: { programWorkoutId: strengthProgramWorkout.id, exerciseId: exercises[1].id, position: 1, plannedSets: [{ reps: 8, weightKg: 60, restSeconds: 120 }, { reps: 8, weightKg: 60, restSeconds: 120 }] } });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
