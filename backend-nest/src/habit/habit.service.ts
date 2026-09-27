import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { HabitRepository } from './habit.repository';
import { Habit, HabitType, GoalType, Frequency, HabitStatus } from './habit.entity';
import { CreateHabitDto } from './dto/create-habit.dto';
import { UpdateHabitDto } from './dto/update-habit.dto';

@Injectable()
export class HabitService {
  constructor(
    private readonly habitRepository: HabitRepository,
  ) {}

  async create(userId: string, createHabitDto: CreateHabitDto): Promise<Habit> {
    this.validateHabit(createHabitDto);

    // Check active habits limit
    const activeHabits = await this.habitRepository.findActiveByUserId(userId);
    if (activeHabits.length >= 20) {
      throw new BadRequestException('MAX_ACTIVE_HABITS_EXCEEDED');
    }

    // Check duplicate name for active habit
    const duplicate = activeHabits.find(h => h.name.toLowerCase() === createHabitDto.name.toLowerCase());
    if (duplicate) {
      throw new ConflictException('DUPLICATE_HABIT_NAME');
    }

    // TODO: Check idempotency key

    return this.habitRepository.create({ ...createHabitDto, userId });
  }

  async findAll(userId: string): Promise<Habit[]> {
    return this.habitRepository.findByUserId(userId);
  }

  async findOne(userId: string, id: string): Promise<Habit> {
    const habit = await this.habitRepository.findOne(id);
    if (!habit || habit.userId !== userId) {
      throw new NotFoundException('HABIT_NOT_FOUND');
    }
    return habit;
  }

  async update(userId: string, id: string, updateHabitDto: UpdateHabitDto): Promise<Habit> {
    const habit = await this.findOne(userId, id);
    this.validateHabitUpdate(habit, updateHabitDto);
    try {
      return this.habitRepository.update(id, updateHabitDto, updateHabitDto.version);
    } catch (e) {
      if (e.message === 'OPTIMISTIC_LOCK_ERROR') {
        throw new ConflictException('OPTIMISTIC_LOCK_ERROR');
      }
      throw e;
    }
  }

  async pause(userId: string, id: string): Promise<Habit> {
    const habit = await this.findOne(userId, id);
    if (habit.status === HabitStatus.ARCHIVED) {
      throw new BadRequestException('CANNOT_PAUSE_ARCHIVED_HABIT');
    }
    return this.habitRepository.update(id, { status: HabitStatus.PAUSED }, habit.version);
  }

  async resume(userId: string, id: string): Promise<Habit> {
    const habit = await this.findOne(userId, id);
    if (habit.status === HabitStatus.ARCHIVED) {
      throw new BadRequestException('CANNOT_RESUME_ARCHIVED_HABIT');
    }
    return this.habitRepository.update(id, { status: HabitStatus.ACTIVE }, habit.version);
  }

  async archive(userId: string, id: string): Promise<Habit> {
    const habit = await this.findOne(userId, id);
    return this.habitRepository.update(id, { status: HabitStatus.ARCHIVED }, habit.version);
  }

  async getToday(userId: string): Promise<Habit[]> {
    // TODO: Return habits with today's tasks
    return this.habitRepository.findActiveByUserId(userId);
  }

  private validateHabit(dto: CreateHabitDto): void {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('NAME_REQUIRED');
    }
    if (!dto.timezone || !dto.timezone.trim()) {
      throw new BadRequestException('TIMEZONE_REQUIRED');
    }
    if (!dto.goalType) {
      throw new BadRequestException('GOAL_TYPE_REQUIRED');
    }

    // Type-specific validation
    switch (dto.type) {
      case HabitType.MEDICATION:
        if (dto.goalType !== GoalType.BOOLEAN) {
          throw new BadRequestException('MEDICATION_MUST_BE_BOOLEAN');
        }
        if (dto.goalValue !== undefined) {
          throw new BadRequestException('MEDICATION_CANNOT_HAVE_NUMERIC_GOAL');
        }
        break;
      case HabitType.STEPS:
        if (dto.goalType !== GoalType.COUNT) {
          throw new BadRequestException('STEPS_MUST_BE_COUNT');
        }
        if (dto.unit !== 'STEPS') {
          throw new BadRequestException('STEPS_UNIT_MUST_BE_STEPS');
        }
        break;
      case HabitType.WATER:
        if (dto.goalType !== GoalType.COUNT) {
          throw new BadRequestException('WATER_MUST_BE_COUNT');
        }
        if (!dto.goalValue || dto.goalValue <= 0) {
          throw new BadRequestException('WATER_GOAL_VALUE_REQUIRED');
        }
        // unit should be ml
        break;
      case HabitType.SLEEP:
      case HabitType.PROTEIN:
      case HabitType.STRETCHING:
      case HabitType.CUSTOM:
        // Custom validation can be added
        break;
    }

    // Frequency validation
    if (dto.frequency === Frequency.WEEKDAYS) {
      if (!dto.daysOfWeek || dto.daysOfWeek.length === 0) {
        throw new BadRequestException('WEEKDAYS_REQUIRED_FOR_WEEKDAY_FREQUENCY');
      }
      for (const day of dto.daysOfWeek) {
        if (day < 1 || day > 7) {
          throw new BadRequestException('INVALID_DAY_OF_WEEK');
        }
      }
    } else if (dto.frequency === Frequency.ONE_TIME) {
      if (!dto.date) {
        throw new BadRequestException('DATE_REQUIRED_FOR_ONE_TIME');
      }
    }
  }

  private validateHabitUpdate(habit: Habit, dto: UpdateHabitDto): void {
    // Prevent changing type/goalType if not allowed
    // Additional validation can be added
  }
}