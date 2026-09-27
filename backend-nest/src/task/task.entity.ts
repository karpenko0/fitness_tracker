export enum TaskStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  SKIPPED = 'SKIPPED',
  EXPIRED = 'EXPIRED',
}

export enum ActionType {
  ADD = 'ADD',
  SET = 'SET',
}

export interface Task {
  id: string;
  habitId: string;
  userId: string;
  date: Date; // local date
  status: TaskStatus;
  progress: number;
  targetValue?: number;
  version: number;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}