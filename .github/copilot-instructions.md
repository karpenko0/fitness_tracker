# Fitness Tracker Project - Copilot Instructions

## Project Overview
Fitness Tracker - приложение для отслеживания физической активности и здоровья с поддержкой:
- REST API Backend (FastAPI + PostgreSQL)
- React Frontend (Mini App + Admin UI)
- RBAC (Role-Based Access Control)
- Audit logs и аналитика
- Multi-tier architecture (Free/Pro plans)

## Architecture
```
fitness_tracker/
├── backend/          # Python FastAPI приложение
├── frontend/         # React приложение с TypeScript
├── docs/             # Документация и спецификации
├── docker/           # Docker конфигурация
├── docker-compose.yml
├── .env.example
└── README.md
```

## Development Setup

### Backend (Python FastAPI)
```bash
cd backend
python -m venv venv
source venv/bin/activate  # или venv\Scripts\activate на Windows
pip install -r requirements.txt
python -m alembic upgrade head
python -m uvicorn app.main:app --reload
```

### Frontend (React)
```bash
cd frontend
npm install
npm start
```

### Docker Compose (для локальной разработки)
```bash
docker-compose up -d
```

## Key Features to Implement

1. **Product Features Management** (SPEC-001)
   - CRUD операции для features и plans
   - Валидация прав доступа (RBAC)
   - Версионирование ресурсов

2. **API Security**
   - JWT Bearer Token authentication
   - Row-level security (владелец может читать/менять только свои данные)
   - Rate limiting

3. **Database**
   - PostgreSQL с миграциями (Alembic)
   - Audit logs для всех изменений
   - Поддержка UTC временных зон

4. **Testing**
   - Unit tests (pytest)
   - Integration tests
   - E2E tests (Cypress/Playwright)

## Important Guidelines

- Все API ошибки возвращают структурированный JSON: `{ "error": { "code": "...", "message": "...", "traceId": "..." } }`
- Изменяющие запросы требуют `Idempotency-Key` header
- Документация в Swagger/OpenAPI
- Логирование traceId, userId, результата операции
- Все временные значения в UTC, отображение по timezone профиля

## Configuration

Используется `.env` файл для конфигурации:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET_KEY` - Secret для JWT токенов
- `ENVIRONMENT` - development/production
- `LOG_LEVEL` - Уровень логирования

## Related Specifications

- SPEC-001: Product Vision & Scope
- SPEC-002: (зависимость)
- SPEC-012, SPEC-014: (зависимости)
- SPEC-016: Для пользовательских модулей
