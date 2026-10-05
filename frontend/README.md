# Frontend - Fitness Tracker React App

React TypeScript приложение для Mini App и Admin UI Fitness Tracker.

## 📋 Требования

- Node.js 18+
- npm или yarn

## 🚀 Установка

### 1. Установить зависимости

```bash
npm install
```

### 2. Создать .env файл

```bash
cp .env.example .env
```

Убедись, что `REACT_APP_API_URL` указывает на твой backend.

### 3. Запустить development сервер

```bash
npm start
```

App будет доступна на `http://localhost:3000`

## 📚 Доступные команды

```bash
# Запустить development сервер
npm start

# Запустить тесты
npm test

# Собрать production версию
npm run build

# Запустить E2E тесты (Cypress)
npm run e2e

# Запустить Cypress UI
npm run e2e:open

# Linting и форматирование
npm run lint
npm run format
```

## 🛡️ Админ-панель (SPEC-011)

UI админ-панели живёт в этом же приложении (не отдельное приложение): роуты
`/admin/*`, код в `src/admin/`, API-клиент — общие сервисы `src/services/api.ts`
(база `/api/v1`).

### Запуск

Нужен запущенный backend (по умолчанию `http://localhost:8000`): Vite dev-сервер
проксирует `/api` на бекенд, браузеру достаточно относительных URL.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # vitest (в т.ч. тесты src/admin)
npm run build      # production-сборка (vite)
```

Локальный seed с тремя ролями:

```bash
cd ../backend && python -m alembic upgrade head
python scripts/seed_admin.py --with-demo-data
```

| Учётка                | Роль              | Что видит |
|-----------------------|-------------------|-----------|
| `root@fittrack.demo`  | SUPER_ADMIN       | Все разделы + пользователи/роли, биллинг, рассылки (пароль `Demo123!`) |
| `admin@fittrack.demo` | ADMIN             | Все разделы, кроме изменения ролей до SUPER_ADMIN и массовых рассылок |
| `content@fittrack.demo` | CONTENT_MANAGER | Только контент/медиа/привычки/челленджи/уведомления; пользователи и биллинг → 403 |

### Ключевые экраны

- `/admin/login` — вход (email + пароль, опционально TOTP при включённом MFA).
- `/admin` (дашборд) — виджеты (не PII; «Нет данных» при малой сегментации).
- `/admin/users` — поиск, блокировка/разблокировка с причиной ≥10 символов, смена роли
  (не выше своей), массовые операции (превью → подтверждение → исполнение).
- `/admin/exercises`, `/admin/programs` — черновики, предпубликационные проверки,
  публикация с версией и reason, rollback, история версий.
- `/admin/billing` (+ `/admin/billing/subscriptions|payments|webhooks`) — подписки,
  платежи (статусы меняет только вебхук), replay вебхуков (идемпотентный);
  ручное изменение статусов недоступно.
- `/admin/promos` — промокоды (в БД только hash кода, не plaintext), лимиты
  с аудитом, redeem транзакционный.
- `/admin/notifications` — шаблоны и кампании (превью → подтверждение).
- `/admin/challenges`, `/admin/habits` — контентные справочники с версионированием.
- `/admin/analytics` — сводные метрики с meta (источник, период, min segment size).
- `/admin/audit-logs` — журнал (append-only, redacted), фильтры incl. поиск по `request_id`.
- `/admin/exports` — асинхронные экспорт, однократная выдача, TTL.
- `/admin/roles`, `/admin/settings` — роли текущей сессии и настройки (MFA-статус).

### Безопасность (что проверено тестами)

RBAC deny-by-default (403/401), IDOR, privilege escalation через тело запроса,
идемпотентность мутаций с `Idempotency-Key` (409 IDEMPOTENCY_KEY_REUSED),
strict-валидация DTO и query-параметров, `X-Request-Id` в каждом ответе,
rate limit (429), маскирование email/telegram/IP/транзакций в ответах и экспортах,
отказ в изменении статуса платежей вручную, защита последнего активного SUPER_ADMIN.

OpenAPI админ-эндпоинтов: [`docs/openapi-admin.json`](../docs/openapi-admin.json).

## 📁 Структура проекта

```
frontend/
├── src/
│   ├── components/          # Переиспользуемые компоненты
│   │   ├── Layout/
│   │   ├── Header/
│   │   ├── Sidebar/
│   │   ├── Forms/
│   │   └── ...
│   ├── pages/               # Страницы приложения
│   │   ├── Dashboard/
│   │   ├── Products/
│   │   ├── Plans/
│   │   ├── Admin/
│   │   └── ...
│   ├── services/            # API сервисы
│   │   ├── api.ts           # Axios инстанс
│   │   ├── authService.ts
│   │   ├── productService.ts
│   │   └── ...
│   ├── store/               # State management (Context API / Redux)
│   ├── hooks/               # Пользовательские hooks
│   ├── utils/               # Утилиты и хелперы
│   ├── styles/              # Глобальные стили
│   ├── types/               # TypeScript типы
│   ├── App.tsx
│   └── index.tsx
├── public/                  # Статические файлы
├── cypress/                 # E2E тесты
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## 🎨 Стилизация

Используется **TailwindCSS** для стилизации компонентов.

```bash
# TailwindCSS уже установлен и настроен
npm install
```

## 🔐 Аутентификация

- Хранение JWT токена в localStorage/sessionStorage
- Автоматическое добавление Authorization header
- Обработка 401 ошибок и редирект на login

## 🧪 Тестирование

### Unit / Integration тесты (Jest + React Testing Library)

```bash
npm test
```

### E2E тесты (Cypress)

```bash
# Запустить тесты headless
npm run e2e

# Открыть Cypress UI
npm run e2e:open
```

## 🛠️ Разработка

### Environment Variables

Создай `.env.local` для локальной разработки:

```env
REACT_APP_API_URL=http://localhost:8000/api/v1
REACT_APP_ENVIRONMENT=development
```

### Hot Reload

Приложение автоматически перезагружается при изменении файлов.

### Debugging

1. Открой Chrome DevTools (F12)
2. Перейди в вкладку "Sources"
3. Размести breakpoints в коде
4. Перезагрузи страницу

## 📖 Типы данных

Типы TypeScript определены в `src/types/`:

```typescript
// Пример
interface User {
  id: string;
  email: string;
  role: 'user' | 'content_manager' | 'admin';
  createdAt: string;
}
```

## 📝 Разработка компонентов

### Создание нового компонента

```typescript
import React from 'react';

interface ComponentProps {
  prop1: string;
  prop2?: number;
}

export const Component: React.FC<ComponentProps> = ({ prop1, prop2 = 0 }) => {
  return (
    <div>
      {prop1}
    </div>
  );
};
```

## 🚀 Production Build

```bash
npm run build
```

Build файлы будут в директории `build/`.

---

**Version**: 1.0.0
