# API Documentation

## Base URL

```
http://localhost:8000/api/v1
```

## Authentication

Все эндпоинты (кроме публичных) требуют JWT Bearer Token:

```
Authorization: Bearer <access_token>
```

## Response Format

### Success Response

```json
{
  "status": "success",
  "data": {
    // response data
  }
}
```

### Error Response

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "traceId": "unique-trace-id"
  }
}
```

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK - Request successful |
| 201 | Created - Resource created successfully |
| 400 | Bad Request - Invalid data |
| 401 | Unauthorized - Missing or invalid token |
| 403 | Forbidden - No permission for this action |
| 404 | Not Found - Resource not found or not accessible |
| 409 | Conflict - Version mismatch or state conflict |
| 422 | Unprocessable Entity - Business rule violation |
| 500 | Internal Server Error |

## Endpoints

### Public Endpoints

#### GET /product/config
Get public product configuration.

**Response:**
```json
{
  "status": "success",
  "data": {
    "features": [...],
    "plans": [...],
    "version": "1.0.0"
  }
}
```

### Authentication Endpoints

#### POST /auth/login
Login with email and password.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "access_token": "token...",
    "token_type": "bearer",
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "user"
    }
  }
}
```

#### POST /auth/signup
Register new user.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "first_name": "John",
  "last_name": "Doe"
}
```

#### GET /auth/me
Get current user info.

**Response:**
```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "role": "user",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

### Product Features Endpoints

#### GET /products/features
List all features (paginated).

**Query Parameters:**
- `page` (int, default=1)
- `pageSize` (int, default=20, max=100)

**Response:**
```json
{
  "status": "success",
  "data": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "items": [...]
  }
}
```

#### GET /products/features/{id}
Get specific feature.

#### POST /products/features
Create new feature (admin only).

**Request Headers:**
```
Idempotency-Key: <uuid>
```

#### PATCH /products/features/{id}
Update feature (admin only).

**Request Headers:**
```
Idempotency-Key: <uuid>
```

### Plans Endpoints

#### GET /plans
List all plans.

#### GET /plans/{id}
Get specific plan.

#### POST /plans
Create new plan (admin only).

#### PATCH /plans/{id}
Update plan (admin only).

### Audit Logs Endpoints (Admin only)

#### GET /audit/logs
List audit logs.

**Query Parameters:**
- `page` (int, default=1)
- `pageSize` (int, default=20, max=100)
- `userId` (uuid, optional)
- `action` (string, optional)

### Habit Endpoints (SPEC-009)

Префикс `/api/v1/habits`. Все записи требуют заголовок `Idempotency-Key` (без него — 409 `IDEMPOTENCY_KEY_REQUIRED`; повтор с тем же ключом и телом возвращает сохранённый ответ, с иным телом — 409 `IDEMPOTENCY_KEY_REUSED`). Ответы в формате `{ "data": ... }`, ошибки `{ "error": { code, message, details?, requestId } }`.

#### POST /habits
Создать привычку (201). Типы: `WATER`, `STEPS`, `SLEEP`, `PROTEIN`, `MEDICATION`, `STRETCHING`, `CUSTOM`. `MEDICATION` — только `goalType: BOOLEAN`; `STEPS` — unit `STEPS`; `WATER` — unit `ML`. Лимит 20 активных (422 `HABIT_LIMIT_EXCEEDED`), дубль активного названия — 409 `DUPLICATE_ACTIVE_HABIT`.

**Request:**
```json
{
  "title": "Пить воду",
  "type": "WATER",
  "goalType": "COUNT",
  "goalValue": 2000,
  "unit": "ML",
  "schedule": "DAILY",
  "weekdays": [],
  "timezone": "Europe/Moscow",
  "reminderTime": "12:30",
  "telegramChatId": "123456"
}
```
`schedule`: `DAILY` | `WEEKDAYS` (нужен `weekdays`, 1=ПН…7=ВС) | `ONE_TIME` (нужна `oneTimeDate`).

#### GET /habits
Список привычек с пагинацией. Query: `status` (`ACTIVE`|`PAUSED`|`ARCHIVED`), `page`, `pageSize`.

#### GET /habits/today
Задания на локальную дату каждой привычки; недостающее задание для активной привычки создаётся на месте.

**Response:**
```json
{
  "data": {
    "items": [
      {
        "habit": { "id": "uuid", "title": "Пить воду", "status": "ACTIVE", "currentStreak": 3, "bestStreak": 7 },
        "localDate": "2026-09-25",
        "task": { "id": "uuid", "status": "PENDING", "progressValue": 500, "version": 1 }
      }
    ]
  }
}
```

#### GET /habits/:id
Привычка целиком (404 `HABIT_NOT_FOUND` для чужой/несуществующей).

#### PATCH /habits/:id
Изменение (title, goalValue, reminderTime, timezone…). Обязателен `version` — при устаревшем 409 `HABIT_VERSION_CONFLICT`. Смена timezone не создаёт ложный разрыв streak (пересчёт по локальным датам).

#### POST /habits/:id/tasks/:taskId/progress
Прогресс задания (201). `action: "ADD"` (инкремент) | `"SET"` (замена), `value` (для `COUNT`; отрицательное — 400 `VALIDATION_ERROR`; для `BOOLEAN` значение запрещено — 400). При достижении цели задание становится `COMPLETED`, streak пересчитывается. Ошибки: 404 `HABIT_TASK_NOT_FOUND`, 409 `HABIT_TASK_VERSION_CONFLICT`, 409 `TASK_ALREADY_CLOSED`.

**Request:**
```json
{ "action": "ADD", "value": 250, "version": 1 }
```

#### POST /habits/:id/tasks/:taskId/skip
Пропуск задания (201). `SKIPPED` рвёт текущий streak (`bestStreak` не уменьшается).

**Request:**
```json
{ "version": 1 }
```

#### POST /habits/:id/pause | /resume | /archive
Управление статусом (200). Пауззированные/архивированные привычки не получают новых заданий и уведомлений. Пауза архивированной — 409.

#### POST /telegram/habits/callback
Webhook для callback-кнопок Telegram-бота «Отметить выполненной». Без JWT; при заданном `TELEGRAM_WEBHOOK_SECRET` требуется заголовок `X-Telegram-Bot-Api-Secret-Token` (иначе 403 `WEBHOOK_SECRET_INVALID`). Callback чужого Telegram-пользователя — 403 `TELEGRAM_CALLBACK_FORBIDDEN`. Повторный callback идемпотентен (ключ `tg:<callback_query.id>`): уже выполненное задание — `{ "data": { "ok": true, "alreadyDone": true } }`.

**Request (тело — Telegram Update):**
```json
{ "callback_query": { "id": "cq1", "from": { "id": 123456 }, "data": "habit_done:<taskId>" } }
```

**Фоновые воркеры:** генерация заданий (каждый час), экспирация незавершённых заданий по окончании локального дня (каждые 15 минут), напоминания Telegram (каждую минуту; не более 3 retry; при блокировке бота уведомления пользователя отключаются; текст для `MEDICATION` нейтральный — без препарата и дозировки).

## Pagination

All list endpoints return paginated results:

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 100,
  "items": [...]
}
```

## Error Codes

| Code | Description |
|------|-------------|
| UNAUTHORIZED | User not authenticated |
| FORBIDDEN | User doesn't have permission |
| NOT_FOUND | Resource not found |
| INVALID_DATA | Request data is invalid |
| CONFLICT | Version mismatch or state conflict |
| BUSINESS_RULE_VIOLATION | Business rule not satisfied |
| INTERNAL_ERROR | Server error |

## Rate Limiting

Rate limiting applies to all endpoints:
- 100 requests per 60 seconds per IP

## Headers

Common headers:

```
Content-Type: application/json
Authorization: Bearer <token>
Idempotency-Key: <uuid> (for mutating requests)
X-Request-ID: <uuid> (optional, for tracing)
```

## Swagger UI

Interactive API documentation available at:
```
http://localhost:8000/docs
```

---

**Version**: 1.0.0
