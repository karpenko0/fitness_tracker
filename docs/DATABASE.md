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
