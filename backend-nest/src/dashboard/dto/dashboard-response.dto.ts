import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CacheDto { @ApiProperty() hit!: boolean; @ApiProperty() expiresAt!: string; }
class MetaDto { @ApiProperty() generatedAt!: string; @ApiProperty() localDate!: string; @ApiProperty() timezone!: string; @ApiProperty() locale!: string; @ApiProperty() snapshotVersion!: number; @ApiProperty() algorithmVersion!: string; @ApiProperty({ type: CacheDto }) cache!: CacheDto; }
class ProgressDto { @ApiProperty() completedExercises!: number; @ApiProperty() totalExercises!: number; @ApiProperty() completedSets!: number; @ApiProperty() totalSets!: number; @ApiProperty() percent!: number; }
class PrimaryActionDto { @ApiProperty() type!: string; @ApiProperty() priority!: number; @ApiProperty() title!: string; @ApiPropertyOptional({ nullable: true }) description!: string | null; @ApiProperty() label!: string; @ApiProperty() deepLink!: string; @ApiPropertyOptional({ nullable: true }) workoutId!: string | null; @ApiPropertyOptional({ nullable: true }) programId!: string | null; @ApiProperty() state!: string; @ApiPropertyOptional({ nullable: true }) scheduledFor!: string | null; @ApiPropertyOptional({ nullable: true }) startedAt!: string | null; @ApiPropertyOptional({ type: ProgressDto, nullable: true }) progress!: ProgressDto | null; }
class SecondaryActionDto { @ApiProperty() type!: string; @ApiProperty() title!: string; @ApiProperty() deepLink!: string; }
class TodayDto { @ApiProperty() state!: string; @ApiProperty() label!: string; @ApiProperty() completedWorkoutCount!: number; @ApiProperty() plannedWorkoutCount!: number; @ApiProperty() restDay!: boolean; @ApiProperty({ type: [SecondaryActionDto] }) secondaryActions!: SecondaryActionDto[]; }
class NextWorkoutDto { @ApiProperty() id!: string; @ApiProperty() title!: string; @ApiProperty() status!: string; @ApiProperty() scheduledFor!: string; @ApiProperty() localScheduledDate!: string; @ApiProperty() programId!: string; @ApiProperty() programTitle!: string; @ApiPropertyOptional({ nullable: true }) estimatedDurationMinutes!: number | null; @ApiPropertyOptional({ nullable: true }) exerciseCount!: number | null; @ApiProperty() deepLink!: string; }
class WeeklyDto { @ApiProperty() completedWorkouts!: number; @ApiPropertyOptional({ nullable: true }) targetWorkouts!: number | null; @ApiPropertyOptional({ nullable: true }) volumeKg!: number | null; @ApiProperty() activeDays!: number; }
class StreakDto { @ApiProperty() currentWeeks!: number; @ApiProperty() bestWeeks!: number; }
class DashboardDataDto {
  @ApiProperty({ type: MetaDto }) meta!: MetaDto;
  @ApiProperty() user!: Record<string, unknown>;
  @ApiProperty() greeting!: Record<string, unknown>;
  @ApiProperty({ type: PrimaryActionDto }) primaryAction!: PrimaryActionDto;
  @ApiProperty({ type: TodayDto }) today!: TodayDto;
  @ApiPropertyOptional({ type: NextWorkoutDto, nullable: true }) nextWorkout!: NextWorkoutDto | null;
  @ApiPropertyOptional({ nullable: true }) activeProgram!: Record<string, unknown> | null;
  @ApiProperty({ type: 'object', properties: { weekly: { $ref: '#/components/schemas/WeeklyDto' }, streak: { $ref: '#/components/schemas/StreakDto' } } }) progress!: Record<string, unknown>;
  @ApiProperty() reminders!: Record<string, unknown>;
  @ApiProperty() onboarding!: Record<string, unknown>;
  @ApiProperty({ type: [SecondaryActionDto] }) quickLinks!: SecondaryActionDto[];
}

export class DashboardResponseDto {
  @ApiProperty({ type: DashboardDataDto }) data!: DashboardDataDto;
}
