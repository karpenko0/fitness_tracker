# SPEC-011. Административная панель FitTrack Pro — план разработки

Статус: выполняется
Дата: 2026-09-30
Основание: `docs` SPEC-011 v1.0 (Draft for implementation)
Отвечает за реализацию: Agent Mode (ветка `arena/01a0f2a2-fitness-tracker`)

## 0. Текущее состояние кода (по результатам аудита)

| Область | Состояние |
|---|---|
| Backend (FastAPI) | Работает: auth, product (plans/features), habits, telegram. PostgreSQL в проде, SQLite (in-memory) в тестах |
| RBAC | Примитивный: проверка `user.role` строкой; нет матрицы `resource:action`, нет deny-by-default |
| Аудит | Есть `audit_logs` (user_id, action, entity, changes, trace_id) — не соответствует разделу 8.2 SPEC-011 |
| Idempotency | Middleware есть (POST/PUT/DELETE), но нет проверки тела → нет 409 IDEMPOTENCY_KEY_REUSED |
| Платёжный домен | **Отсутствует** (есть только `plans`) — подписки/платежи/webhook для админки придётся создать |
| Контент (упражнения/программы/медиа) | **Отсутствует** |
| Промокоды, челленджи, шаблоны уведомлений, аналитика | **Отсутствуют** |
| Frontend | Мини-приложение React; административной части нет |
| Тесты (исходно) | 12 упавших тестов:IndentationError в `app/habits/services.py` и `tests/test_habits.py`, отсутствующие `pause_habit`/`archived_at`, сравнение date/datetime в SQLite, str→UUID binding в `get_current_user` и `record_audit`, утечка данных между тестами (session-scoped DB) |

## 1. Принцип разбивки

Каждая фаза завершается: (1) рабочим кодом, (2) зелёным тестовым прогоном, (3) коммитом.
Ограничение §14 SPEC: production-публикация, возвраты, массовые рассылки и hard delete —
за Approval Gate (флаг окружения `ADMIN_APPROVAL_GATE_ENABLED`, по умолчанию включён:
критичные операции требуют `confirm: true` в теле запроса; при `false` — немедленное выполнение).

## 2. Фазы

### Фаза 0. Стабилизация базовой линии ✅
- Исправить `app/habits/services.py` (индентация, `habitat`→`habit`, статусы задач,
  `update_streak` без `habit`, Decimal-арифметика, progressPercent).
- Модели: `local_date`/`scheduled_local_date`/`last_completed_local_date` → `Date`, добавить `archived_at`;
  добавить `pause_habit`.
- `get_current_user`: парсинг `sub` в UUID (строчный `sub` из JWT падал на SQLite и падал бы на PostgreSQL),
  блокировка `is_active=False` → 403 (заблокированный пользователь не проходит в клиентское API).
- `record_audit`: str/UUID нормализация user_id/entity_id.
- `tests/conftest.py`: сброс БД перед каждым тестом (изоляция).
- Правки тестов (отсутствующие импорты, version-snapshots, Date-сравнения).
- **Критерий:** 22/22 тестов зелёные.

### Фаза 1. Админ-фундамент (backend)
- `app/admin/` пакет: models, schemas, services, routes.
- Модели: `admin_sessions`, `admin_mfa_challenges`, `admin_audit_logs` (по 8.2 + индексы),
  `admin_exports`, `idempotency_keys` (расширение: `request_hash`, TTL), `analytics_daily_aggregates`.
- Авторизация: `POST /admin/auth/login` (отдельный endpoint), проверка пароля + роли + статуса;
  выпуск admin JWT (`typ=admin`, `sid`), сессия в `admin_sessions`; idle 30 мин → статус IDLE;
  критичные действия при IDLE/отсутствии step-up → 401 `STEP_UP_REQUIRED`;
  MFA-ready: `ADMIN_MFA_ENABLED` + `admin_mfa_challenges` (challenge → verify), провайдер код-проверки
  подключаемый (в dev — `ADMIN_MFA_DEV_CODE`), в prod без верификатора логин запрещён.
- RBAC: матрица разрешений из 6.4, `require_permission()` (deny-by-default),
  аудит `admin.permission.denied`; запрет `role`/`userId` из тела без проверки сервером.
- Middleware: `X-Request-Id` на все ответы; rate limit 60/мин на admin-пользователя
  (отдельный счётчик для `/api/v1/admin`); формат ошибок `{error:{code,message,details,requestId}}`.
- Маскирование: email, telegram id, provider transaction id, ip-hash.
- Idempotency: требование `Idempotency-Key` для всех mutation admin-endpoint (400 без ключа),
  409 `IDEMPOTENCY_KEY_REUSED` при повторе с другим телом (хеш тела), повтор с тем же телом → тот же ответ.
- Migration 0002 (alembic) + rollback.
- **Критерий:** RBAC-матрица покрыта тестами; 401/403/409-сценарии; маска в ответах.

### Фаза 2. Dashboard, пользователи, роли
- `GET /admin/dashboard`: виджеты (значение, период, updated_at, ссылка на список);
  `None` → «Нет данных» вместо искусственного нуля.
- `GET /admin/users` (поиск: id, email, имя, статус, телеграм-id маскированно; page/pageSize/sort/filter; pageSize≤100),
  `GET /admin/users/{id}` (карточка: профиль, статус, роли+источник, тариф/подписки, последние действия,
  флаги, last login, ссылка на audit).
- `POST /admin/users/{id}/block|unblock`: причина ≥10 символов, before/after в audit,
  блокировка последнего SUPER_ADMIN запрещена (409), блокировка не трогает историю.
- `POST /admin/users/{id}/roles`, `DELETE /admin/users/{id}/roles/{role}`:
  нельзя выдать роль выше собственной, ADMIN не выдаёт SUPER_ADMIN, источник назначения сохраняется.
- Массовая блокировка: `POST /admin/users/bulk/block` preview (count) → confirm → execution, audit `admin.bulk.*`.
- `GET /admin/roles`: матрица ролей и разрешений.
- **Критерий:** сценарии 11.1/11.2.

### Фаза 3. Подписки и платежи (read-only + replay)
- Модели платёжного домена: `subscriptions`, `payments`, `payment_webhook_events`.
- `GET /admin/billing/subscriptions|payments` (маскированный provider tx id, история webhook-событий).
- `POST /admin/billing/webhooks/{id}/replay`: идемпотентный replay (event_id → один обработчик),
  audit `admin.billing.webhook.replayed`.
- Ручное изменение статуса: endpoint `POST /admin/billing/payments/{id}/status` возвращает 403
  (`billing:manual_status` отсутствует у всех ролей — только webhook/reconciliation).
- **Критерий:** сценарии 11.5 (replay, 409), 12.3.3.

### Фаза 4. Контент: упражнения, медиа, программы, привычки, уведомления, челленджи, промокоды
- Упражнения: CRUD + валидация обязательных полей, slug unique, тип/сложность/мышцы/оборудование/
  локализации/версия; альтернативы: совместимость по типу и группе, **детект циклов** при сохранении;
  удаление: только soft-delete; нельзя удалить, если используется опубликованной программой (архивация).
- Медиа: MIME-allowlist + проверка magic-bytes, размер, checksum SHA-256 (оригинал),
  публичный URL через opaque-токен (внутренний путь не раскрывается),
  удаление заблокировано при ссылке из опубликованного контента; audit `admin.media.uploaded/rejected`.
- Программы: структура недель/тренировок/упражнений, правила прогрессии, версии и changelog.
  Workflow DRAFT→IN_REVIEW→APPROVED→PUBLISHED→ARCHIVED (машина переходов);
  pre-publish проверки (6.6): slug, название/описание на обязательной локали, упражнения не удалены,
  порядок и ссылки, циклы альтернатив, длительность и ≥1 тренировка, оборудование, диапазоны
  подходов/повторений/веса/отдыха. Публикация — атомарная (версия + событие + audit в одной транзакции),
  предыдущие версии сохраняются, rollback = новая версия по старому снапшоту.
- Уведомления: шаблоны (whitelist переменных, каналы, timezone policy, quiet hours, лимит частоты,
  статус/версия) + кампании (preview аудитории → count → confirm; повторный запуск не создаёт дубли).
- Привычки (каталог): цель, периодичность, диапазон, напоминания, streak policy, статус публикации;
  изменение каталога не трогает исторические выполнения пользователей (отдельные таблицы + версии).
- Челленджи: типы, даты, правила, целевое значение, условия, повторное участие, видимость;
  публикация версионируется (`challenge_versions`), изменение правил опубликованного — только новой версией.
- Промокоды: нормализация/хеш кода, уникальность, даты, 0–100%, фикс ≥ 0, лимиты, тарифы, сегменты,
  причина; архивированный нельзя активировать; изменение лимитов — с аудитом;
  `POST /admin/promo-codes/{id}/redeem` — транзакционное/идемпотентное применение (атомарный счётчик +
  unique (code, user) на `promo_redemptions`).
- **Критерий:** сценарии 11.3, 11.4, 11.5 (промокоды), 12.3.1/5/6/7.

### Фаза 5. Аналитика, аудит, экспорт
- `GET /admin/analytics/*`: DAU/WAU/MAU, воронка регистраций, удержание D1/D7/D30, конверсия Free→Pro,
  churn/истекающие подписки, доход, использование контента, доставляемость, ошибки API.
  Источник — `analytics_daily_aggregates` (предагрегаты) + таблицы домена; каждый ответ несёт
  период, фильтры, источник, задержку данных, время обновления.
  Минимальный размер сегмента (конфиг) — чувствительные поля скрываются/агрегируются.
  CONTENT_MANAGER — только `/analytics/content`.
- `GET /admin/audit-logs`: фильтры actor/action/resource/period, маскирование, audit на чтение `admin.audit.read`.
- Экспорт CSV: `POST /admin/exports` (асинхронная задача в отдельном потоке), TTL-ссылка,
  одноразовая загрузка, лимит строк; audit `admin.analytics.export_requested`.
- **Критерий:** сценарии 11.6, 12.3.8/9.

### Фаза 6. Frontend: административная панель (React, русский)
- `/admin/login` — вход (email+пароль, MFA-шаг при необходимости), отдельный `admin_token`.
- Layout c боковым меню; пункты зависят от ролей (RBAC из `GET /admin/roles`);
  403/401 перехват → экраны, step-up повторный вход для критичных действий.
- Страницы: Dashboard (виджеты, «Нет данных», ссылки на списки), Пользователи (таблица/поиск/карточка,
  block/unblock с причиной и подтверждением, роли), Роли, Биллинг (подписки/платежи/webhook+replay),
  Упражнения (+альтернативы, медиа), Программы (workflow, версии, publish/unpublish с confirm),
  Уведомления (шаблоны + кампании с preview/confirm), Привычки, Челленджи, Промокоды,
  Аналитика (период/фильтры/meta), Журнал действий, Настройки (SUPER_ADMIN).
- Все критичные действия — из клавиатуры, с явным подтверждением (approval gate);
  базовый WCAG 2.1 AA (контраст, focus, aria-роли).
- **Критерий:** vitest для логина/nav; E2E-сценарии 12.3 воспроизводимы ручным smoke-test.

### Фаза 7. Тесты, OpenAPI, документация, smoke-test
- Integration-тесты backend (pytest): матрица RBAC, IDOR, блокировка, транзакционность publish+audit,
  concurrency промокода, идемпотентность, rate limit, неизвестные DTO-поля, маскирование, outbox (аудит atomically).
- Security-тесты (subset): privilege escalation (role в теле), IDOR, повтор mutation, XSS-поля,
  polyglot-файл в медиа, секреты в логах/экспортe, brute force login, обход approval gate,
  повтор webhook с другой подписью, удаление последнего SUPER_ADMIN.
- OpenAPI: FastAPI auto-генерация + теги admin; экспорт `docs/openapi-admin.json` в CI-совместимом виде.
- Документация: README (запуск админки, миграции), план миграции/отката для production.
- Seed-скрипт `backend/scripts/seed_admin.py` (3 админ-роли + тестовые данные) + ручной smoke-test по 3 ролям.

## 3. Не входит в эту итерацию (согласно §4.2 и §14)

raw SQL, ручное изменение платёжного статуса, полные реквизиты, рекламные кампании,
real-time аналитика (<1 мин), изменение infra-конфига, multi-tenant (tenantId — open question),
выбор MFA-провайдера, retention-политики, hard delete (только soft-delete + анонимизация по approval gate).

## 4. Проверка приёмки

Пункты 11.1–11.7 закрываются тестами Фазы 7; не выполняемые в песочнице нагрузки (100 RPS и т.п.)
фиксируются в отчёте как «требует production-окружения».
