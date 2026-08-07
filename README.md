# Fitness Tracker - REST API & Mini App

Приложение для отслеживания физической активности и здоровья с поддержкой REST API, React Frontend и RBAC (Role-Based Access Control).

## 📋 Описание

Fitness Tracker - полнофункциональное приложение для мониторинга здоровья пользователей:
- **REST API** на Python FastAPI с PostgreSQL
- **React Frontend** с TypeScript (Mini App + Admin UI)
- **RBAC** система управления доступом (User, Content Manager, Admin)
- **Audit logs** для аудита всех изменений
- **Multi-tier** архитектура с поддержкой Free и Pro планов

## 🏗️ Архитектура

```
fitness_tracker/
├── backend/              # Python FastAPI API
│   ├── app/
│   │   ├── main.py
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── api/routes/
│   │   ├── services/
│   │   ├── middleware/
│   │   └── utils/
│   ├── migrations/        # Alembic миграции
│   ├── tests/
│   ├── requirements.txt
│   └── README.md
│
├── frontend/             # React TypeScript App
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── store/
│   │   ├── hooks/
│   │   └── utils/
│   ├── public/
│   ├── package.json
│   └── README.md
│
├── docs/                 # Документация
│   ├── SPEC-001.md
│   ├── API.md
│   ├── ARCHITECTURE.md
│   └── DATABASE.md
│
├── docker/               # Docker конфиги
│   ├── Dockerfile.backend
│   └── Dockerfile.frontend
│
├── docker-compose.yml
├── .env.example
└── README.md
```

## 🚀 Быстрый старт

### Требования

- Python 3.10+
- Node.js 18+
- PostgreSQL 14+
- Docker и Docker Compose (опционально)

### Локальная разработка

#### 1. Backend (Python FastAPI)

```bash
# Перейти в директорию backend
cd backend

# Создать виртуальное окружение
python -m venv venv

# Активировать окружение (Windows)
venv\Scripts\activate
# или (macOS/Linux)
source venv/bin/activate

# Установить зависимости
pip install -r requirements.txt

# Применить миграции БД
python -m alembic upgrade head

# Запустить приложение
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API будет доступна на `http://localhost:8000`
Swagger документация: `http://localhost:8000/docs`

#### 2. Frontend (React TypeScript)

```bash
# Перейти в директорию frontend
cd frontend

# Установить зависимости
npm install

# Запустить development сервер
npm start
```

App будет доступна на `http://localhost:3000`

### Docker Compose (One-Command Setup)

```bash
# Из корня проекта
docker-compose up -d

# Проверить статус контейнеров
docker-compose ps

# Остановить
docker-compose down
```

## 📚 Спецификации

- **SPEC-001**: Product Vision & Scope
- **API Documentation**: `/docs/API.md`
- **Architecture**: `/docs/ARCHITECTURE.md`
- **Database Schema**: `/docs/DATABASE.md`

## 🔐 Безопасность

- JWT Bearer Token authentication
- RBAC система с тремя ролями (User, Content Manager, Admin)
- Row-level security (пользователи видят только свои данные)
- Идемпотентность для операций с изменением состояния
- Все временные значения в UTC
- Структурированные ошибки с трассировкой (traceId)

## 🧪 Тестирование

```bash
# Backend тесты
cd backend
pytest

# Frontend тесты
cd frontend
npm test

# E2E тесты
npm run e2e
```

## 📝 Логирование и Мониторинг

- Логирование с `traceId`, `userId` и результатом операции
- Audit logs для административных действий
- Метрики: error rate, p95 latency, успешные/неуспешные операции
- Структурированные JSON логи

## 🛠️ Разработка

### Соглашения по коду

- Backend: PEP 8 (black, flake8)
- Frontend: ESLint + Prettier
- Комментарии на русском языке
- Type hints для Python и TypeScript

### Git Workflow

```bash
git checkout -b feature/description
# Сделать изменения
git add .
git commit -m "feat: описание изменения"
git push origin feature/description
# Создать Pull Request
```

## 📖 Дополнительное

- **Contributing**: Смотри документацию для контрибьюторов
- **License**: MIT
- **Issues**: Используй GitHub Issues для баг-репортов

## 📞 Контакты

Для вопросов обращайся в отдел разработки.

---

**Version**: 1.0.0  
**Last Updated**: 2026-07-26
