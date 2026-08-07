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

---

**Version**: 1.0.0
