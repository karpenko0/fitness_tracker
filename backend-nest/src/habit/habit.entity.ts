export enum HabitType {
  WATER = 'WATER',
  STEPS = 'STEPS',
  SLEEP = 'SLEEP',
  PROTEIN = 'PROTEIN',
  MEDICATION = 'MEDICATION',
  STRETCHING = 'STRETCHING',
  CUSTOM = 'CUSTOM',
}

export enum GoalType {
  BOOLEAN = 'BOOLEAN',
  COUNT = 'COUNT',
}

export enum Frequency {
  DAILY = 'DAILY',
  WEEKDAYS = 'WEEKDAYS',
  ONE_TIME = 'ONE_TIME',
}

export enum HabitStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ARCHIVED = 'ARCHIVED',
}

export interface Habit {
  id: string;
  userId: string;
  name: string;
  type: HabitType;
  goalType: GoalType;
  goalValue?: number;
  unit?: string;
  frequency: Frequency;
  daysOfWeek?: number[];
  date?: Date;
  timezone: string;
  status: HabitStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}