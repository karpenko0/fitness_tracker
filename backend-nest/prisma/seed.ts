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
    { id: '00000000-0000-4000-8000-000000000001', title: 'Новичок: домашняя база', goals: ['HEALTH', 'MAINTENANCE'], levels: ['BEGINNER'], locations: ['HOME', 'MIXED'], workoutsPerWeek: 3, durationMinutes: 30, requiredEquipment: ['BODYWEIGHT'], firstWorkoutTitle: 'Тренировка 1: базовая', isFallback: true },
    { id: '00000000-0000-4000-8000-000000000002', title: 'Снижение веса: домашние тренировки', goals: ['WEIGHT_LOSS'], levels: ['BEGINNER', 'INTERMEDIATE'], locations: ['HOME'], workoutsPerWeek: 3, durationMinutes: 30, requiredEquipment: ['BODYWEIGHT'], firstWorkoutTitle: 'Тренировка 1: всё тело', isFallback: false },
    { id: '00000000-0000-4000-8000-000000000003', title: 'Сила: зал', goals: ['STRENGTH', 'MUSCLE_GAIN'], levels: ['INTERMEDIATE', 'ADVANCED'], locations: ['GYM'], workoutsPerWeek: 4, durationMinutes: 60, requiredEquipment: ['BARBELL', 'DUMBBELLS'], firstWorkoutTitle: 'Тренировка 1: верх тела', isFallback: false },
  ];
  for (const program of programs) {
    await prisma.starterProgram.upsert({ where: { id: program.id }, update: { ...program, status: 'PUBLISHED', active: true }, create: { ...program, status: 'PUBLISHED', active: true } });
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
