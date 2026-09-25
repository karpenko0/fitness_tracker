# Database Schema

## Таблицы

### product_features
Таблица для хранения фич продукта.

```sql
CREATE TABLE product_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  release_stage VARCHAR(50) NOT NULL, -- alpha, beta, production
  enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_product_features_code ON product_features(code);
CREATE INDEX idx_product_features_enabled ON product_features(enabled);
```

### plans
Таблица для хранения тарифных планов.

```sql
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL, -- active, inactive, archived
  price NUMERIC(10, 2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_plans_code ON plans(code);
CREATE INDEX idx_plans_status ON plans(status);
```

### users
Таблица для хранения пользователей.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'user', -- user, content_manager, admin
  timezone VARCHAR(50) DEFAULT 'UTC',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
```

### audit_logs
Таблица для логирования всех административных действий.

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(255) NOT NULL,
  entity_type VARCHAR(255),
  entity_id UUID,
  changes JSONB,
  status VARCHAR(50), -- success, failure
  trace_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
```

### Habit (SPEC-009)
Привычки пользователя. Миграция `20260925120000_habits` (Prisma-модели Habit/HabitTask/HabitTaskEvent/HabitNotification).

```sql
CREATE TABLE "Habit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "title" varchar(120) NOT NULL,
  "type" "HabitType" NOT NULL,          -- WATER, STEPS, SLEEP, PROTEIN, MEDICATION, STRETCHING, CUSTOM
  "goalType" "HabitGoalType" NOT NULL,  -- COUNT | BOOLEAN
  "goalValue" numeric(10,2),
  "unit" "HabitUnit",                   -- STEPS, ML, GRAMS, MINUTES, TIMES
  "schedule" "HabitSchedule" NOT NULL,  -- DAILY | WEEKDAYS | ONE_TIME
  "weekdays" integer[] NOT NULL DEFAULT ARRAY[]::integer[],  -- 1=ПН ... 7=ВС
  "oneTimeDate" date,
  "timezone" text NOT NULL,             -- IANA; локальная дата заданий/streak
  "reminderTime" text,                  -- 'HH:MM' локального времени
  "telegramChatId" text,
  "status" "HabitStatus" NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | PAUSED | ARCHIVED
  "pausedAt" timestamptz,
  "archivedAt" timestamptz,
  "currentStreak" integer NOT NULL DEFAULT 0,
  "bestStreak" integer NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 1, -- optimistic locking
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "Habit_userId_status_idx" ON "Habit"("userId", "status");
```

### HabitTask
Одно задание на привычку на локальную дату (`localDate` — DATE на UTC-полночь локального дня привычки). Дедупликация: `@@unique([habitId, localDate])`. Статусы: `PENDING → COMPLETED | SKIPPED | EXPIRED`.

```sql
CREATE TABLE "HabitTask" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "habitId" uuid NOT NULL REFERENCES "Habit"("id") ON DELETE CASCADE,
  "localDate" date NOT NULL,
  "status" "HabitTaskStatus" NOT NULL DEFAULT 'PENDING',
  "progressValue" numeric(10,2),
  "completedAt" timestamptz,
  "skippedAt" timestamptz,
  "expiredAt" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("habitId", "localDate")
);
CREATE INDEX "HabitTask_habitId_localDate_status_idx" ON "HabitTask"("habitId", "localDate", "status");
```

### HabitTaskEvent
Аудит изменений прогресса: `action` (`ADD`|`SET`), `value`, `source` (`API` | `TELEGRAM_CALLBACK`).

```sql
CREATE TABLE "HabitTaskEvent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId" uuid NOT NULL REFERENCES "HabitTask"("id") ON DELETE CASCADE,
  "action" "HabitTaskAction" NOT NULL,
  "value" numeric(10,2),
  "source" text NOT NULL DEFAULT 'API',
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "HabitTaskEvent_taskId_createdAt_idx" ON "HabitTaskEvent"("taskId", "createdAt");
```

### HabitNotification
Напоминания Telegram. Дедупликация: `@@unique([habitId, taskLocalDate, kind])` — одно напоминание на задание. Статусы: `SCHEDULED → SENT | FAILED | CANCELLED`; `attempts` — не более 4 попыток (1 + 3 retry); при блокировке бота `lastError = 'BOT_BLOCKED'` и `User.notificationsDisabled = true`.

```sql
CREATE TABLE "HabitNotification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "habitId" uuid NOT NULL REFERENCES "Habit"("id") ON DELETE CASCADE,
  "taskLocalDate" date NOT NULL,
  "kind" text NOT NULL DEFAULT 'DAILY_REMINDER',
  "status" "HabitNotificationStatus" NOT NULL DEFAULT 'SCHEDULED',
  "attempts" integer NOT NULL DEFAULT 0,
  "lastError" text,
  "sentAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("habitId", "taskLocalDate", "kind")
);
CREATE INDEX "HabitNotification_status_habitId_idx" ON "HabitNotification"("status", "habitId");
```

Также миграция добавляет `User.notificationsDisabled boolean NOT NULL DEFAULT false` (отключение уведомлений при блокировке бота).

## Миграции

Миграции управляются через Alembic. Для создания новой миграции:

```bash
alembic revision --autogenerate -m "description"
alembic upgrade head
```

## Временные значения

- Все временные значения хранятся в UTC (TIMESTAMPTZ)
- Отображение выполняется по timezone профиля пользователя
- Расчёт дня выполняется по timezone профиля

## Индексы

Созданы индексы на:
- Внешние ключи (для быстрого поиска связанных данных)
- Часто используемые поля фильтрации (status, role, enabled, etc.)
- Поля для сортировки (created_at)

## Вопросы безопасности

- Пароли хранятся как хеши (bcrypt)
- Используется Row-Level Security (RLS) для доступа к данным
- Все изменения логируются в audit_logs
