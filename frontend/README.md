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
