# SPEC-009. Привычки (Habits) — аудит и план разработки

**Дата:** 2026-09-23
**Ветка:** `arena/01a0ceac-fitness-tracker`
**Целевой код:** `backend-nest` (NestJS 10 + Prisma 5 + PostgreSQL) — активная разработка ведётся здесь (последний коммит `fc2512f` — модуль измерений/прогресса в `backend-nest`). Параллельный `backend/` (FastAPI) содержит только auth/user/plan и в работах по SPEC-009 не участвует.

---

## 1. Результаты аудита: что уже готово

Проверено поиском по обоим бэкендам (`grep -ri "habit\|streak\|привычк"`) и разбором `prisma/schema.prisma`:

> **Модуль привычек не реализован.** Слова `habit` в коде нет ни разу (проверено `grep -ri habit` по `backend-nest/src`, `backend/app`, `prisma/schema.prisma`); в схеме Prisma нет моделей Habit/HabitTask, нет воркеров, нет отправки Telegram-сообщений (есть только валидация `initData` для входа — `src/auth/services/telegram-validation.service.ts`).
> Уточнение: в dashboard есть **недельный streak тренировок** (`StreakDto {currentWeeks, bestWeeks}` в `src/dashboard/dto/dashboard-response.dto.ts`, расчёт `streak()`/`bestStreak()` в `src/dashboard/dashboard-aggregation.service.ts:73-74` + unit-тест). Это не streak привычек из SPEC-009, но готовый паттерн расчёта streak по локальным датам с учётом timezone — использовать как референс для `streak.service.ts`.

Статус всех требований спецификации — **«не готово»** (детальная таблица — раздел 8).

### 1.1 Инфраструктура, которую можно переиспользовать

| Компонент | Где лежит | Как пригодится |
|---|---|---|
| Идемпотентность (`IdempotencyKey`, хэш тела, 409 `IDEMPOTENCY_KEY_REUSED`) | `src/workout/workout.service.ts` (метод `idempotent()`), `src/program/program.service.ts`, модель `IdempotencyKey` в схеме | Вынести в общий `IdempotencyService` и применять ко всем записям SPEC-009 |
| Optimistic locking (`version` + 409 `*_VERSION_CONFLICT`) | `src/workout/workout.service.ts` (`bump()`, `updateMany where version`) | Тот же паттерн для Habit/HabitTask |
| Глобальный rate limiting | `ThrottlerModule` + `APP_GUARD` в `src/app.module.ts` | Покрывает требование rate limiting |
| Маскирование логов | `src/common/utils/redact-sensitive-data.ts` (+ тест `test/unit/redact-sensitive-data.spec.ts`) | Расширить ключи (`medication_note`, `telegram_init_data` и т.п.) |
| JWT-auth + ownership | `JwtAuthGuard`/`AuthGuard('jwt')`, паттерн `where: { id, userId }` | 401/403/404 для чужих данных |
| Локальные даты/timezone | `src/dashboard/timezone.service.ts` (+ unit-тест) | Расчёт «локального дня» привычек |
| Контракт ответов | `TransformInterceptor` (`{ data }`), `HttpExceptionFilter`, `ValidationPipe` с `VALIDATION_ERROR` | Единый формат ошибок `{ code, message }` |
| Метрики/интерсепторы | `ProgressionApiMetricsInterceptor` | Замер p95 |

### 1.2 Что пришлось починить до начала работ (сделано в этой сессии)

Проект в исходном состоянии **не компилировался и не запускал часть тестов**. Исправлено (все правки — в ветке сессии):

1. `prisma/schema.prisma` был в кодировке **UTF-16LE** (Prisma CLI не парсит) → конвертирован в UTF-8.
2. В схеме были **продублированы 26 моделей/enum** (блок строк 649–1016 — побайтовая копия 281–648) и два разных `model Measurement` → дубли удалены, оставлена актуальная версия `Measurement` (с `timezone`, `note`) + добавлены недостающие back-relations (`User.progressPhotos/progressAggregates`, `Measurement.values/photos`).
3. `src/app.module.ts:10` — незакрытая кавычка в импорте `WorkoutModule` (валило сборку).
4. `src/prisma.module.ts` — `new PrismaClient()` выполнялся **на import модуля** (побочный эффект ронял jest-воркеры) → заменён на `useFactory`.
5. 5 модулей (`measurement`, `progress-chart`, `progress-comparison`, `progress-photo`, `progress-aggregate`) импортировали несуществующий `../prisma/prisma.module` → исправлено на `../prisma.module`.
6. Те же 4 контроллера не имели обязательного префикса `api/v1` (контракт SPEC-001) → добавлен.
7. `src/measurement/dto/measurement.dto.ts` и `src/progress-photo/dto/progress-photo.dto.ts` — битые/обрезанные файлы (декораторы внутри type literal, обрезанный класс) → переписаны (nested DTO + `PartialType`).
8. `progress-comparison.service.ts` — **реальный баг**: `previousTo.getMilliseconds - 1` (без `()`) давал `Invalid Date` → любой WEEK/MONTH-запрос падал бы на `toISOString()`; исправлено, добавлены интеграционные тесты (`test/integration/api.spec.ts` восстановлен из обрезанного фрагмента).
9. `progression.service.ts` — запрос к удалённому полю `Measurement.weightKg` → переведён на `MeasurementValue (metric=WEIGHT)`.
10. `progress-chart.service.ts` — Decimal-арифметика, `Map.get()!`, повторное объявление `sum` в switch, повтор `const sum` — исправлено.
11. Мелочи: `Number()`-конверсии Decimal, guard для `completedAt === null`, необязательный `options` в `findAll`, моки в `program.service.spec.ts`.

**Проверено:** `npx tsc --noEmit` → 0 ошибок; `npx jest` → **31/31 suites, 151/151 tests**, стабильно в 3 прогонах подряд; `npx nest build` → успешно.

### 1.3 Известные проблемы вне scope SPEC-009

- ✅ `measurement.service.ts` — ключи `circumferencesCm` (`neck`, `bicepsLeft`) писались в `MeasurementValue.metric` как есть вместо `NECK`, `BICEPS_LEFT` → исправлено (маппинг `MEASUREMENT_METRIC_BY_DTO_KEY`).
- ✅ Мусорные артефакты (`jest-results.json`, `temp_without_measurement.prisma`, `schema_additions.txt`, `.env — копия.example`) — удалены.
- ⬜ Миграции Prisma не включают таблиц measurement-модуля (последняя до habits — `20260915180000_programs_catalog`) — остаётся отдельной задачей.

---

## 2. Архитектура модуля

```
src/habit/
├── habit.module.ts
├── dto/
│   ├── create-habit.dto.ts          # валидация типов/целей/расписания (class-validator)
│   ├── update-habit.dto.ts          # PartialType + version (optimistic locking)
│   └── task-progress.dto.ts         # action ADD|SET, value, version
├── habit.service.ts                 # CRUD, pause/resume/archive, лимит 20, дубли, ownership
├── habit-validation.service.ts      # чистые правила: тип↔цель, единицы, расписание, время напоминаний
├── habit-task.service.ts            # генерация заданий, ADD/SET, skip, expire, уникальность (habitId, localDate)
├── streak.service.ts                # чистый пересчёт current/best streak по истории заданий
├── habit-local-date.service.ts      # локальная дата/день недели по IANA timezone (Intl.DateTimeFormat)
├── workers/
│   ├── habit-task-generation.worker.ts   # cron: создание заданий на локальный день (idempotent upsert)
│   ├── habit-expire.worker.ts            # cron: EXPIRED для незавершённых по окончании локального дня
│   └── habit-reminder.worker.ts          # ежеминутный выбор due-напоминаний, отправка, retry ≤3, dedup
├── telegram/
│   ├── telegram-bot.client.ts       # sendMessage/sendPhoto + обработка 429/403 (blocked)
│   ├── habit-notification.service.ts# нейтральные тексты (MEDICATION без названий/дозировок!), dedup, outbox
│   └── habit-callback.controller.ts # webhook: callback «Отметить выполненной», проверка telegramUserId
└── queries/
    └── habit-today.query.ts         # GET /habits/today — один составной запрос (цель p95 ≤ 300 мс)
```

**Ключевые решения:**

1. **Воркеры** — добавить зависимость `@nestjs/schedule` (сейчас её нет) и запускать cron-задачи в том же процессе (для MVP достаточно; масштабирование — позже через BullMQ + Redis, Redis уже есть в зависимостях).
2. **Локальный день** — `localDate` хранится как `DATE` (строка `YYYY-MM-DD`) в таймзоне привычки; все сравнения «сегодня/окончание дня» — через `habit-local-date.service` (покрывает требование «смена timezone не создаёт ложный разрыв streak»: streak считается по последовательности `localDate`, а не по UTC-инстантам).
3. **Задания** — уникальность `@@unique([habitId, localDate])`; генерация через `upsert`/`createMany skipDuplicates` → воркер идемпотентен, два задания невозможны даже при гонке.
4. **Streak** — не инкрементируется «на лету», а **пересчитывается** детерминированной чистой функцией `recalcStreak(tasks: {localDate, status}[], schedule, timezone)` при каждом изменении задания (COMPLETED/SKIPPED/EXPIRED) — покрывает требования «изменение выполнения до конца дня корректно пересчитывает streak», «SKIPPED/EXPIRED разрывают», «дни вне расписания не разрывают».
5. **Уведомления** — outbox-таблица `HabitNotification` с dedup-ключом `(habitId, taskLocalDate, kind)` + `attempts`; worker берёт due-записи, шлёт через `telegram-bot.client`, при 429/5xx — retry с backoff, `attempts ≥ 3` → FAILED; при 403 (бот заблокирован) → `User.notificationsDisabled = true`, отправка прекращается (требование «при блокировке бота уведомления отключаются»). Ошибка доставки **не** трогает статусы привычки/задания.
6. **Idempotency-Key** — обязателен для всех POST/PATCH (уже есть паттерн `idempotent()` — вынести в `src/common/services/idempotency.service.ts`).
7. **Безопасность текста MEDICATION** — шаблонизатор уведомлений принимает только `{habitTitle-neutral, time}`; для MEDICATION фиксированный нейтральный текст («Пора выполнить привычку»), без данных из `note`/названия/дозировок; unit-тест проверяет, что в текст не попадают поля привычки.

---

## 3. Модель данных (Prisma)

```prisma
enum HabitType        { WATER STEPS SLEEP PROTEIN MEDICATION STRETCHING CUSTOM }
enum HabitGoalType    { COUNT BOOLEAN DURATION MINUTES ML }
enum HabitUnit        { STEPS ML MINUTES GRAMS TIMES }
enum HabitSchedule    { DAILY WEEKDAYS ONE_TIME }
enum HabitStatus      { ACTIVE PAUSED ARCHIVED }
enum HabitTaskStatus  { PENDING COMPLETED SKIPPED EXPIRED }
enum HabitTaskAction  { ADD SET }
enum HabitNotificationStatus { SCHEDULED SENT FAILED CANCELLED }

model Habit {
  id            String        @id @default(uuid())
  user          User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId        String
  title         String        @db.VarChar(120)
  type          HabitType
  goalType      HabitGoalType
  goalValue     Decimal?      @db.Decimal(10, 2)   // null только для BOOLEAN
  unit          HabitUnit?
  schedule      HabitSchedule
  weekdays      Int[]                              // 1..7 для WEEKDAYS
  oneTimeDate   DateTime?     @db.Date             // для ONE_TIME
  timezone      String                             // IANA, обязательна
  reminderTime  String?                            // "HH:mm" локальное
  telegramChatId String?
  status        HabitStatus   @default(ACTIVE)
  pausedAt      DateTime?
  archivedAt    DateTime?
  currentStreak Int           @default(0)
  bestStreak    Int           @default(0)
  version       Int           @default(1)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  tasks         HabitTask[]
  notifications HabitNotification[]
  @@index([userId, status])
}

model HabitTask {
  id             String          @id @default(uuid())
  habit          Habit           @relation(fields: [habitId], references: [id], onDelete: Cascade)
  habitId        String
  localDate      DateTime        @db.Date
  status         HabitTaskStatus @default(PENDING)
  progressValue  Decimal?        @db.Decimal(10, 2)
  completedAt    DateTime?
  skippedAt      DateTime?
  expiredAt      DateTime?
  version        Int             @default(1)
  events         HabitTaskEvent[]
  @@unique([habitId, localDate])          // два задания на одну дату невозможны
  @@index([habitId, localDate, status])   // p95 GET /habits/today
}

model HabitTaskEvent {        // аудит ADD/SET + основа пересчёта
  id        String         @id @default(uuid())
  task      HabitTask      @relation(fields: [taskId], references: [id], onDelete: Cascade)
  taskId    String
  action    HabitTaskAction
  value     Decimal?       @db.Decimal(10, 2)
  source    String         // API | TELEGRAM_CALLBACK
  createdAt DateTime       @default(now())
}

model HabitNotification {
  id            String                  @id @default(uuid())
  habit         Habit                   @relation(fields: [habitId], references: [id], onDelete: Cascade)
  habitId       String
  taskLocalDate DateTime                @db.Date
  kind          String                  @default("DAILY_REMINDER")
  status        HabitNotificationStatus @default(SCHEDULED)
  attempts      Int                     @default(0)
  lastError     String?
  sentAt        DateTime?
  @@unique([habitId, taskLocalDate, kind])   // дедупликация напоминаний
}
```

Плюс: поле `notificationsDisabled Boolean @default(false)` на `User` (или отдельная настройка) — для отключения при блокировке бота. Миграция — одна новая `..._habits` (и заодно недостающая миграция measurement-модуля — см. 1.3).

---

## 4. API-контракты (префикс `/api/v1`, ответ в `{ data }`, ошибки `{ error: { code, message } }`)

| Метод | Путь | Назначение | Idempotency-Key | Ошибки |
|---|---|---|---|---|
| POST | `/habits` | создать привычку | обязателен | 400 VALIDATION_ERROR, 409 DUPLICATE_ACTIVE_HABIT, 422 HABIT_LIMIT_EXCEEDED (>20), 409 IDEMPOTENCY_KEY_* |
| GET | `/habits?status=` | список привычек (page/pageSize) | — | 401 |
| GET | `/habits/:id` | привычка + streak | — | 401/404 (чужая = 404) |
| PATCH | `/habits/:id` | изменить (title, цель, расписание, reminderTime, timezone) | обязателен | 400, 404, 409 HABIT_VERSION_CONFLICT |
| POST | `/habits/:id/pause` / `resume` / `archive` | смена статуса | обязателен | 404, 409 HABIT_STATUS_INVALID |
| GET | `/habits/today` | задания на локальную дату (+ habit-сводка) | — | 401; цель p95 ≤ 300 мс |
| POST | `/habits/:id/tasks/:taskId/progress` | `{action: ADD\|SET, value?, version}` | обязателен | 400 VALIDATION_ERROR (отрицательные, число для BOOLEAN), 404, 409 HABIT_TASK_VERSION_CONFLICT |
| POST | `/habits/:id/tasks/:taskId/skip` | пропуск незавершённого | обязателен | 404, 409 TASK_ALREADY_CLOSED |
| GET | `/habits/:id/history?from&to` | история заданий + streak-динамика | — | 401/404 |
| POST | `/api/v1/telegram/habits/callback` | webhook callback-кнопок | по telegram callback_query.id | 403 (чужой telegramUserId), повторный callback → тот же результат без дубля |

Правила валидации (habit-validation.service): MEDICATION → только BOOLEAN; STEPS → только COUNT+STEPS; WATER → ML; title/timezone/goal обязательны; reminderTime `HH:mm` 00:00–23:59; WEEKDAYS → непустой массив 1..7; ONE_TIME → дата не в прошлом.

---

## 5. Поэтапный план разработки

### Фаза 0 — Гигиена (0.5 дня) ✅ ГОТОВО
- [x] Baseline зелёный: tsc 0 ошибок, jest 31/31 (см. 1.2).
- [x] Удалён мусор (`jest-results.json`, `temp_without_measurement.prisma`, `schema_additions.txt`, `.env — копия.example`).
- [x] Починен enum-баг `circumferencesCm`: добавлен `MEASUREMENT_METRIC_BY_DTO_KEY` (camelCase → `NECK`/`BICEPS_LEFT`), применяется в create и update. (Миграция measurement-модуля — по-прежнему отдельной задачей.)
- [x] Создан `src/common/services/idempotency.service.ts` (используется модулем привычек). Перевод workout/program на него отложен, чтобы не трогать их конструкторы и тесты.

### Фаза 1 — Модель данных + CRUD привычек (2 дня) ✅ ГОТОВО
> Реализовано: enum-ы и модели Habit/HabitTask/HabitTaskEvent/HabitNotification + `User.notificationsDisabled` в схеме, миграция `20260925120000_habits`; модуль `src/habit/` (dto, habit-validation.service, habit.service, habit.controller `api/v1/habits`, module), регистрация в AppModule. Тесты: `habit-validation.service.spec.ts` (24), `habit.service.spec.ts` (17), `test/integration/habits.api.spec.ts` (16) — всего 57, все зелёные; полный прогон 34/34 suites, 208/208 tests.
- Prisma-модели и enum из раздела 3 + миграция; seed-демо.
- `create-habit.dto` + `habit-validation.service` (все правила типов/целей/расписания).
- `habit.service`: create (лимит 20 активных → 422; дубль активного по title → 409), list/get (ownership!), patch (version → 409), pause/resume/archive.
- Idempotency-Key на всех записях; 401 без токена.
- **Unit:** валидация всех типов/целей, периодичности, лимит 20, дубли. **Integration:** POST/GET/PATCH, pause/resume/archive, идемпотентность, ownership, 401, rate limiting.
- *DoD:* требования блоков «Создание и управление привычками» и частично «Безопасность» закрыты тестами.

### Фаза 2 — Ежедневные задания и прогресс (2 дня) ✅ ГОТОВО
> Реализовано: `HabitLocalDateService` (локальная дата/день недели по IANA tz), `HabitTaskService` (генерация по DAILY/WEEKDAYS/ONE_TIME, upsert по `@@unique([habitId, localDate])` + страховка P2002, ADD/SET, авто-COMPLETED при progress ≥ goal, BOOLEAN без числового значения, skip, EXPIRED по окончании локального дня с учётом tz привычки, optimistic locking, ownership), `GET /habits/today` (on-demand генерация для активных), воркеры `@nestjs/schedule`: генерация каждый час, экспирация каждые 15 минут; задание создаётся сразу при создании привычки. Тесты: `habit-local-date.service.spec.ts` (4), `habit-task.service.spec.ts` (22), `habit-workers.spec.ts` (2), `test/integration/habit-tasks.api.spec.ts` (12) — 40 новых; полный прогон 38/38 suites, 248/248 tests. Streak при завершении задания пока не пересчитывается — это Фаза 3.
- `habit-task.service`: генерация (DAILY — одно на локальный день; WEEKDAYS — только выбранные дни; ONE_TIME — одно на дату; PAUSED/ARCHIVED — не генерируются), ADD/SET, авто-COMPLETED при progress ≥ goal, skip, expire-worker (незавершённые → EXPIRED по окончании локального дня; COMPLETED не трогается).
- `habit-task-generation.worker` (@nestjs/schedule, cron каждый час + при создании привычки — генерация на сегодня), идемпотентный upsert.
- GET `/habits/today` одним составным запросом + индексы.
- **Unit:** создание заданий по всем расписаниям, дубли невозможны, ADD/SET, авто-завершение, все переходы статусов, отрицательные → 400, число для BOOLEAN → 400. **Integration:** обновление/пропуск задания, история, optimistic locking (409), два параллельных POST progress → нет двойного увеличения (транзакция + version).
- *DoD:* блок «Ежедневные задания» закрыт.

### Фаза 3 — Streak (1.5 дня) ✅ ГОТОВО
> Реализовано: `HabitStreakService` — чистая функция `computeCurrentStreak` (последовательные COMPLETED по расписанию; дни вне расписания не рвут; SKIPPED/EXPIRED рвут; PENDING текущего дня не рвёт до конца локального дня; обход от max(сегодня, последнее задание) — смена timezone не создаёт ложный разрыв; ONE_TIME = 0/1; дни до создания привычки не учитываются) + `recalcForHabit` (bestStreak = max(старый, текущий) — не уменьшается; запись только при изменении). Пересчёт вызывается в той же транзакции при завершении/прогрессе задания, при skip и после EXPIRED-прохода воркера. Тесты: `habit-streak.service.spec.ts` (13) + интеграционная проверка пересчёта в `habit-task.service.spec.ts`; полный прогон 39/39 suites, 262/262 tests.
- `streak.service.recalcStreak()` — чистая функция (полный набор unit-кейсов): последовательные COMPLETED по расписанию +1; пропуск дня вне расписания не рвёт; SKIPPED/EXPIRED рвут; текущий незакрытый день не рвёт; bestStreak монотонна; смена timezone — пересчёт по localDate без ложного разрыва.
- Вызов пересчёта из всех мутаций заданий (в той же транзакции).
- **Unit:** все 8 требований блока Streak. **Integration:** изменение выполнения до конца дня → streak пересчитан.
- *DoD:* блок «Streak» закрыт.

### Фаза 4 — Telegram-уведомления и callbacks (2.5 дня) ✅ ГОТОВО
> Реализовано: `telegram/telegram-bot.client.ts` — fetch к Bot API (`sendMessage` → `{ok}` | retry (429 c `retry_after`, 5xx, сеть) | blocked (403) | fatal (прочие 4xx); токен не попадает в сообщения об ошибках); `telegram/habit-notification.service.ts` — планирование SCHEDULED-уведомлений для активных привычек с невыполненным заданием (dedup через `@@unique([habitId, taskLocalDate, kind])`, findUnique+create), выбор due по локальному времени привычки (`Intl` в её tz), отправка: SENT / retry ≤ 3 (всего ≤ 4 попыток) → FAILED / blocked → `user.notificationsDisabled = true` + FAILED 'BOT_BLOCKED' + отмена прочих SCHEDULED пользователя; для COMPLETED/SKIPPED/EXPIRED задания и ARCHIVED привычки → CANCELLED без отправки; PAUSED и отключённые уведомления — пропуск; статусы привычки/задания не меняются; MEDICATION — нейтральный фиксированный текст без названия/дозировки. `workers/habit-reminder.worker.ts` — cron каждую минуту (SLA ≤ 2 мин). `telegram/habit-callback.service.ts` + `habit-callback.controller.ts` — `POST /api/v1/telegram/habits/callback` (`habit_done:<taskId>`, чужой telegramUserId → 403 TELEGRAM_CALLBACK_FORBIDDEN, COMPLETED → `{ok:true, alreadyDone:true}`, иначе идемпотентный ключ `tg:<callback_query.id>` → тот же `updateProgress` c source `TELEGRAM_CALLBACK`; опц. секрет вебхука `X-Telegram-Bot-Api-Secret-Token` ↔ `TELEGRAM_WEBHOOK_SECRET`, добавлен в `.env.example`). Тесты: `telegram-bot.client.spec.ts` (8), `habit-notification.service.spec.ts` (18), `habit-callback.service.spec.ts` (10), reminder-воркер в `habit-workers.spec.ts` (3), `test/integration/habit-callback.api.spec.ts` (7) — 46 новых; полный прогон 43/43 suites, 307/307 tests.
- `telegram-bot.client` (fetch к Bot API, mock в тестах): sendMessage, обработка 429 (retry_at), 403 → blocked.
- `habit-reminder.worker`: ежеминутный выбор due-напоминаний (локальное время пользователя, окно ≤ 2 мин при штатной работе — cron каждую минуту), не шлёт для COMPLETED/PAUSED/ARCHIVED, dedup через `HabitNotification @@unique`, retry ≤ 3 с backoff, при blocked → отключение уведомлений пользователя; ошибка доставки не меняет статусы.
- Нейтральный текст для MEDICATION (без препарата/дозировки/медицинских заметок) — отдельный unit-тест на содержимое.
- `habit-callback.controller`: верификация `telegramUserId == habit.telegramChatId` (чужой → 403/отклонён), «Отметить выполненной» → тот же code path, что и API progress SET goal; повторный callback (по `callback_query.id`) → идемпотентный ответ, без дубля выполнения.
- **Unit:** выбор задач воркером, retry-политика, дедупликация, валидация времени, лимиты, masking, валидация/идемпотентность callbacks. **Integration:** отправка через mock Telegram API, retry+блокировка, обработка кнопок.
- *DoD:* блок «Telegram-уведомления» закрыт.

### Фаза 5 — Безопасность, качество, производительность (1 день)
- Расширить `redact-sensitive-data` (telegram initData, bot token, медицинские заметки) + тест.
- Проверка: 401/ownership/409/429 по всем новым роутам (integration).
- p95: замер через `load-smoke.js`-подобный сценарий для `/habits/today` и progress-update (цель ≤ 300 мс; локально — без сети, на моках БД измеряем только handler-time; полноценный замер — на стенде с PostgreSQL, зафиксировать в CI-инструкциях).
- Аудит логов: grep по логам на токены/initData/notes.

### Фаза 6 — E2E и документация (1.5 дня)
E2E-сценарии (Cypress во `frontend/cypress` либо supertest-сценарии поверх поднятого API с тестовой БД):
1. «Вода»: создать → +250 мл → цель → streak+1.
2. «Шаги» ПН/СР/ПТ: вторник не рвёт streak.
3. «Растяжка»: напоминание в (mock) Telegram → callback «Отметить выполненной».
4. MEDICATION: нейтральный текст уведомления.
5. Skip → streak сброшен.
6. Не выполнил до конца дня → EXPIRED.
7. Пауза → нет новых заданий и уведомлений.
8. Блокировка бота → фиксация блокировки, уведомления отключены.
9. Два параллельных progress-запроса → нет двойного прогресса.
10. Чужая привычка → отказ доступа.
- Обновить `docs/API.md`, `docs/DATABASE.md`, Swagger.

**Итого: ~11 рабочих дней** (Фазы 1–4 — критический путь; Фазу 6 можно параллелить с 5).

---

## 6. План тестирования (маппинг на §16 спецификации)

### Unit (`src/habit/*.spec.ts`, `test/unit/`)
| Требование | Тест-файл |
|---|---|
| валидация типов привычек и целей | `habit-validation.service.spec.ts` |
| валидация DAILY/WEEKDAYS/ONE_TIME | `habit-validation.service.spec.ts` |
| создание ежедневных заданий / дубли | `habit-task.service.spec.ts` |
| ADD и SET / авто-завершение / переходы статусов | `habit-task.service.spec.ts` |
| текущий и лучший streak / дни вне расписания / timezone | `streak.service.spec.ts` |
| валидация времени уведомлений / лимиты напоминаний | `habit-notification.service.spec.ts` |
| выбор задач для worker / retry / дедупликация | `habit-reminder.worker.spec.ts` |
| валидация и идемпотентность callbacks | `habit-callback.controller.spec.ts` |
| маскирование чувствительных данных | `redact-sensitive-data.spec.ts` (расширить) |

### Integration (`test/integration/habits.api.spec.ts` и др., паттерн — mock Prisma как в существующих spec)
POST/GET/GET:id/PATCH /habits · pause/resume/archive · GET /habits/today · обновление/пропуск задания · история · optimistic locking (409) · ownership/RBAC · идемпотентность всех записей (повтор ключа = тот же ответ; другой body = 409 IDEMPOTENCY_KEY_REUSED) · rate limiting (429) · генерация заданий воркером · Telegram через mock API · retry и блокировка бота · callback-кнопки.

### E2E — 10 сценариев из Фазы 6.

---

## 7. Риски

| Риск | Митигация |
|---|---|
| Нет `@nestjs/schedule` в зависимостях | Добавить в Фазе 2; для тестов — прямой вызов методов воркера (без реального cron) |
| Нет тестовой БД в песочнице (нет PostgreSQL/Redis) | Integration-тесты на mock-Prisma (сложившаяся практика репо); реальные DB-тесты — отдельным профилем в CI со стендом |
| Prisma-движки недоступны offline | В песочнице: `PRISMA_ENGINES_MIRROR` на локальный стаб (см. 9); в CI — обычный доступ в сеть |
| p95 нельзя честно измерить без БД | Измерять на стенде; в репо — скрипт и порог в документации |
| Telegram Bot API недоступен из песочницы | Только mock; контракт клиента покрыть contract-тестами |

## 8. Статус чек-листа спецификации

**Все ~60 требований блоков «Создание и управление привычками», «Ежедневные задания», «Streak», «Telegram-уведомления», «Безопасность и качество», «Тестирование» — НЕ реализованы** (аудит от 2026-09-23: ни одного совпадения `habit|streak` в `backend-nest/src`, `backend/app`, `prisma/schema.prisma`). Покрытие по фазам:

- Создание/управление привычками (10 требований) → Фаза 1 ✅ (кроме «пауза/архив не создаёт новых заданий» — проверяется в Фазе 2 вместе с генерацией заданий)
- Ежедневные задания (12) → Фаза 2
- Streak (8) → Фаза 3
- Telegram-уведомления (12) → Фаза 4 ✅
- Безопасность и качество (9) → Фазы 1–5 (сквозные)
- Unit/Integration/E2E (§16) → Фазы 1–6

Готово на сегодня: только базовая инфраструктура (auth, idempotency-паттерн, rate limiting, маскирование логов, timezone-утилиты) и зелёный baseline тестов.

## 9. Как запускать проверки в этой песочнице

Сеть песочницы блокирует `binaries.prisma.sh`, `nodejs.org`, GitHub release assets, поэтому:

```bash
cd backend-nest
NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/e2b-ca.crt npm install --ignore-scripts
# argon2 — собрать из исходников с локальными заголовками node:
cd node_modules/argon2 && npm_config_nodedir=/usr/local node ../.bin/node-pre-gyp install --fallback-to-build --build-from-source && cd ../..
# Prisma Client — через локальный mirror-заглушку движков (скрипт engine-mirror):
PRISMA_ENGINES_MIRROR=http://127.0.0.1:8765 DATABASE_URL=... DIRECT_URL=... npx prisma generate
# Проверки:
npx tsc -p tsconfig.json --noEmit   # 0 ошибок
npx jest                            # 31/31 suites, 151/151 tests
npx nest build -p tsconfig.json     # успешно
```

(Движок Prisma — заглушка: тесты работают на mock-PrismaClient; подключение к реальной БД в песочнице невозможно.)
