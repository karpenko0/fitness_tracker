import { Injectable } from '@nestjs/common';
import { Habit, HabitStatus } from './habit.entity';

@Injectable()
export class HabitRepository {
  private habits: Map<string, Habit> = new Map();

  create(habit: Partial<Habit>): Habit {
    const id = crypto.randomUUID();
    const newHabit: Habit = {
      id,
      userId: habit.userId,
      name: habit.name,
      type: habit.type,
      goalType: habit.goalType,
      goalValue: habit.goalValue,
      unit: habit.unit,
      frequency: habit.frequency,
      daysOfWeek: habit.daysOfWeek,
      date: habit.date,
      timezone: habit.timezone,
      status: HabitStatus.ACTIVE,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Habit;
    this.habits.set(id, newHabit);
    return newHabit;
  }

  find(): Habit[] {
    return Array.from(this.habits.values()).filter(h => h.status === HabitStatus.ACTIVE);
  }

  findOne(id: string): Habit | undefined {
    return this.habits.get(id);
  }

  findByUserId(userId: string): Habit[] {
    return Array.from(this.habits.values()).filter(h => h.userId === userId);
  }

  findActiveByUserId(userId: string): Habit[] {
    return Array.from(this.habits.values()).filter(h => h.userId === userId && h.status === HabitStatus.ACTIVE);
  }

  update(id: string, updates: Partial<Habit>, expectedVersion: number): Habit | null {
    const habit = this.habits.get(id);
    if (!habit) return null;
    if (habit.version !== expectedVersion) {
      throw new Error('OPTIMISTIC_LOCK_ERROR');
    }
    const updated = { ...habit, ...updates, version: habit.version + 1, updatedAt: new Date() };
    this.habits.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.habits.delete(id);
  }
}