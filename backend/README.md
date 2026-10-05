# Backend - Fitness Tracker REST API

Python FastAPI приложение для REST API Fitness Tracker.

## 📋 Требования

- Python 3.10+
- PostgreSQL 14+
- pip или poetry

## 🚀 Установка

### 1. Создать виртуальное окружение

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate
```

### 2. Установить зависимости

```bash
pip install -r requirements.txt
```

### 3. Создать .env файл

```bash
cp .env.example .env
```

### 4. Применить миграции БД

```bash
python -m alembic upgrade head
```

### 5. Запустить приложение

```bash
python -m uvicorn app.main:app --reload
```

API будет доступна на `http://localhost:8000`

## 📚 Документация

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## 🧪 Тестирование

```bash
# Запустить тесты
pytest

# С покрытием
pytest --cov=app

# Конкретный тест
pytest tests/test_auth.py::test_login
```

## 📁 Структура проекта

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI приложение
│   ├── config.py            # Конфигурация
│   ├── models/              # SQLAlchemy модели
│   ├── schemas/             # Pydantic schemas
│   ├── api/                 # API routes
│   │   ├── routes/
│   │   │   ├── auth.py
│   │   │   ├── products.py
│   │   │   ├── plans.py
│   │   │   └── audit.py
│   │   └── dependencies.py
│   ├── services/            # Бизнес-логика
│   ├── middleware/          # Middleware (JWT, logging, etc)
│   ├── utils/               # Утилиты
│   └── exceptions.py        # Исключения
├── migrations/              # Alembic миграции
├── tests/                   # Тесты
├── requirements.txt
├── .env.example
└── README.md
```

## 🔐 Аутентификация и Авторизация

- JWT Bearer Token
- RBAC система с ролями: User, Content Manager, Admin
- Row-level security (RLS)

## 📝 Разработка

### Запуск с горячей перезагрузкой

```bash
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Создать новую миграцию

```bash
alembic revision --autogenerate -m "description"
alembic upgrade head
```

## 🛠️ Полезные команды

```bash
# Форматирование кода
black app/
flake8 app/

# Type checking
mypy app/

# Всё вместе
black app/ && flake8 app/ && mypy app/ && pytest
```

## 📖 API Reference

Полная документация доступна в Swagger UI после запуска приложения.
OpenAPI-субнабор админ-панели (SPEC-011): `docs/openapi-admin.json`
(регенерация: `python backend/scripts/export_openapi_admin.py`).

## 🛡️ Админ-панель (SPEC-011)

Админ-панель — это не отдельное приложение, а часть этого API: все правила
домена основного API применяются и здесь. База URL: `/api/v1/admin`.

### Миграции

- `0001_initial_schema` — legacy-схема (users, plans, product_features,
  audit_logs, idempotency_keys).
- `0002_admin_panel_spec_011` — таблицы админ-панели (пользователи-аудит,
  контент, промокоды, биллинг/вебхуки, медиа, экспорт, сессии, MFA) + добор
  legacy-индексов.

```bash
python -m alembic upgrade head      # установка
python -m alembic downgrade -1      # откат одной миграции (проверено до 0001)
```

Схема 0002 согласована с `Base.metadata` (колонки и индексы), создаёт
legacy-индексы идиотентно (через inspector) и откатывается обратно в состояние
0001. Перед релизом гоняйте миграции на чистой копии production-БД.

### Seed для локальной разработки

```bash
python -m alembic upgrade head
python scripts/seed_admin.py --with-demo-data
```

Скрипт идемпотентен (по email / slug) и создаёт три админ-учётки
(пароль по умолчанию `Demo123!`, переопределяется `ADMIN_SEED_PASSWORD`):

| Email                 | Роль              |
|-----------------------|-------------------|
| `root@fittrack.demo`  | SUPER_ADMIN       |
| `admin@fittrack.demo` | ADMIN             |
| `content@fittrack.demo` | CONTENT_MANAGER |

Вместе с `--with-demo-data` — демо-пользователи, подписки, платёж + вебхук,
упражнения, программа, привычка, челлендж, промокод, шаблон уведомлений.
**Не запускать в production.**

### Ключевые переменные окружения

| Переменная                     | По умолчанию     | Назначение |
|--------------------------------|------------------|------------|
| `DATABASE_URL`                 | —                | Строка подключения БД |
| `JWT_SECRET_KEY`               | dev-заглушка     | **Обязателен в production** |
| `AUDIT_IP_SALT`                | dev-заглушка     | Соль хэширования IP в аудите, **обязательна в production** |
| `ADMIN_TOKEN_HOURS`            | `8`              | Время жизни admin JWT |
| `ADMIN_SESSION_IDLE_MINUTES`   | `30`             | Idle-таймаут сессии (step-up) |
| `ADMIN_MFA_ENABLED`            | `false`          | Включить MFA (TOTP) для админов |
| `ADMIN_RATE_LIMIT_REQUESTS`    | `60` / 60 c      | Rate limit админ-эндпоинтов |
| `ADMIN_EXPORT_RATE_LIMIT_*`    | `10` / 3600 c    | Rate limit запросов экспорта |
| `ADMIN_EXPORT_TTL_MINUTES`     | `15`             | TTL файлов экспорта (однократная выдача) |
| `APPROVAL_GATE_ENABLED`        | `true`           | Гейт §14: publish/возвраты/массовая рассылка требуют одобрения |

### Тесты

```bash
pytest tests/admin            # интеграционные и security-тесты SPEC-011
pytest                        # весь бекенд
```

Покрывают: RBAC-матрицу и deny-by-default, IDOR, privilege escalation через
тело запроса, поток блокировки с причиной и аудитом, защиту последнего
SUPER_ADMIN, идемпотентность мутаций (409 на переиспользование ключа с другим
телом), strict-валидацию DTO/query, rate limit 429, `X-Request-Id`,
маскирование PII в ответах/экспортах, идемпотентный replay вебхуков,
отказ в ручном изменении статуса платежей, поиск аудита по `request_id`.

---

**Version**: 1.0.0
