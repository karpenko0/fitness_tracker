# SPEC-011. Чек-лист приёмки

Дата: 2026-10-05. Статусы: ✅ закрыто тестами / ручной проверкой · ⚠️ требует
production-окружения (песочница ограничена) · ❌ не выполнено.

Источники доказательства: `backend/tests/admin/*` (58 тестов),
`frontend` vitest (25 тестов), живой smoke-test в dev-среде (backend :8000 +
Vite :3000, sqlite, seed `backend/scripts/seed_admin.py --with-demo-data`).

## 1. Доступ и RBAC (11.1, 11.2)

| № | Критерий | Статус | Доказательство |
|---|----------|--------|----------------|
| 1.1 | Нелогинованный → 401 на `/admin/*` | ✅ | `test_rbac.py::test_no_token_gets_401` |
| 1.2 | Expired/отозванная сессия → 401 | ✅ | `test_rbac.py::test_expired_token_gets_401`, `test_revoked_session_gets_401` |
| 1.3 | Не-admin пользователь → 403 | ✅ | `test_rbac.py::test_non_admin_user_gets_403`, `test_client_role_login_admin_endpoint_forbidden` |
| 1.4 | CM не видит пользователей/биллинг/роли (deny-by-default) | ✅ | `test_rbac.py::test_content_manager_cannot_see_users_billing_roles` |
| 1.5 | ADMIN не выдаёт SUPER_ADMIN; роль выше своей запрещена | ✅ | `test_rbac.py::test_admin_cannot_assign_super_admin`, `test_unknown_role_deny_by_default` |
| 1.6 | Privilege escalation через тело запроса → 400/403 | ✅ | `test_rbac.py::test_privilege_escalation_via_body_rejected` |
| 1.7 | Idle-сессия требует step-up повторного входа | ✅ | `test_rbac.py::test_idle_session_requires_step_up` (401 STEP_UP_REQUIRED → ре-логин с challenge) |
| 1.8 | Матрица ролей: `GET /admin/roles` | ✅ | ручная проверка + `roles`-раздел фронтенда |

## 2. Пользователи и блокировка (11.1/11.2)

| № | Критерий | Статус | Доказательство |
|---|----------|--------|----------------|
| 2.1 | Block/unblock: причина ≥10 символов, confirm, before/after в аудите | ✅ | `test_users.py::test_block_requires_reason_and_confirm`, `test_block_unblock_flow_with_audit` |
| 2.2 | Заблокированный не входит в клиентское приложение | ✅ | `test_users.py::test_blocked_user_cannot_use_client_app` |
| 2.3 | Нельзя заблокировать последнего активного SUPER_ADMIN (409) | ✅ | `test_users.py::test_self_block_forbidden_and_last_super_admin` |
| 2.4 | ADMIN не понижает SUPER_ADMIN | ✅ | `test_users.py::test_admin_cannot_demote_super_admin` |
| 2.5 | Источник назначения роли сохраняется | ✅ | `test_users.py::test_role_assign_records_source` |
| 2.6 | Массовая блокировка: preview (count) → confirm → execution, аудит | ✅ | `test_users.py::test_bulk_block_preview_then_execute` |
| 2.7 | Поиск + маскирование email в списках | ✅ | `test_users.py::test_user_list_search_and_masking` |

## 3. Контент: публикация, версии, медиа (11.3, 12.3.1/5/6/7)

| № | Критерий | Статус | Доказательство |
|---|----------|--------|----------------|
| 3.1 | Pre-publish проверки (обязательные поля, ссылки, ≥1 тренировка, диапазоны) | ✅ | `test_content.py` (вход в IN_REVIEW/publish без подготовки → ошибки) |
| 3.2 | Публикация атомарна: версия + событие + аудит в одной транзакции | ✅ | `test_content.py` (rollback транзакции → нет версии и нет audit) |
| 3.3 | Rollback = новая версия по старому снапшоту; архивный нельзя перепубликовать (409) | ✅ | `test_content.py`, `test_catalog.py` |
| 3.4 | Изменение опубликованного — только новой версией | ✅ | `test_catalog.py` (published-режим `create_new_version`) |
| 3.5 | Медиа: MIME-allowlist + magic-bytes; polyglot/исполняемый файл → 415 | ✅ | `test_content.py` (MIME/полиглот) |
| 3.6 | Удаление медиа, ссылаемого из опубликованного контента → 409 IN_USE | ✅ | `test_catalog.py` |
| 3.7 | Программа: workflow DRAFT→IN_REVIEW→APPROVED→PUBLISHED, версия+reason | ✅ | `test_content.py` |

## 4. Промокоды и биллинг (11.4, 11.5, 12.3.3)

| № | Критерий | Статус | Доказательство |
|---|----------|--------|----------------|
| 4.1 | Код в БД только как hash (SHA-256 `promo:CODE`), uniqueness по hash | ✅ | seed/модель + `test_catalog.py` |
| 4.2 | Валидация: 0–100%, fixed ≥ 0, end ≥ start, архивный не активируется (409) | ✅ | `test_catalog.py` |
| 4.3 | Изменение лимитов — с аудитом | ✅ | `test_catalog.py` |
| 4.4 | Redeem: транзакционный, идемпотентный, конкурентный race без двойного применения | ✅ | `test_catalog.py` (конкурентный redeem: один успех, другой 409/limit) |
| 4.5 | Статусы платежей не меняются вручную (403 у всех ролей) | ✅ | `test_billing.py::test_manual_status_change_always_403` |
| 4.6 | Provider tx id маскирован в ответах | ✅ | `test_billing.py::test_payment_list_masks_transaction_id` |
| 4.7 | Replay вебхука идемпотентен; невалидная подпись отклоняется | ✅ | `test_billing.py::test_replay_idempotent_updates_once`, `test_replay_invalid_signature_refused` |

## 5. Аналитика, аудит, экспорт (11.6, 12.3.8/9)

| № | Критерий | Статус | Доказательство |
|---|----------|--------|----------------|
| 5.1 | Каждый ответ аналитики несёт meta (период, источник, фильтры, updated_at, min_segment_size) | ✅ | `test_analytics_audit.py::test_analytics_meta_fields` |
| 5.2 | Сегмент меньше минимального → null («Нет данных»), не 0 | ✅ | `test_analytics_audit.py::test_analytics_segment_size_zero_returns_nulls` |
| 5.3 | CM — только `/analytics/content` | ✅ | RBAC-тесты (1.4) + аудит-тесты |
| 5.4 | Аудит: полные поля, append-only, redacted, чтение само логируется | ✅ | `test_analytics_audit.py::test_audit_log_fields_and_read_denied_for_cm` |
| 5.5 | Поиск аудита по `request_id` (оператор восстанавливает все записи запроса) | ✅ | `test_analytics_audit.py::test_audit_search_by_request_id` |
| 5.6 | Экспорт: асинхронный, TTL-ссылка, однократная выдача (410), лимит строк, маскирование | ✅ | `test_analytics_audit.py::test_export_one_time_and_ttl`, `test_export_endpoint_masks_sensitive_data`, `test_export_unknown_kind_rejected`, `test_non_admin_cannot_export` |

## 6. Протокол API (SPEC-011 9.x)

| № | Критерий | Статус | Доказательство |
|---|----------|--------|----------------|
| 6.1 | Все мутации `/admin/*` требуют `Idempotency-Key` (400 без него) | ✅ | `test_idempotency_admin.py::test_idempotency_key_required_on_admin_mutations` |
| 6.2 | Один ключ + то же тело → тот же результат (кэш) | ✅ | `test_idempotency_admin.py::test_idempotency_same_body_same_result` |
| 6.3 | Один ключ + другое тело → 409 IDEMPOTENCY_KEY_REUSED | ✅ | `test_idempotency_admin.py::test_idempotency_different_body_409` |
| 6.4 | Legacy-клиентские эндпоинты работают как раньше (ключ опционален) | ✅ | `test_idempotency_admin.py::test_legacy_client_endpoints_still_work_with_key` |
| 6.5 | Неизвестные query-параметры и DTO-поля → 400 | ✅ | `test_idempotency_admin.py::test_unknown_query_param_rejected`, `test_unknown_dto_field_rejected` |
| 6.6 | `X-Request-Id` в каждом ответе; ошибка несёт requestId | ✅ | `test_idempotency_admin.py::test_request_id_on_every_response` |
| 6.7 | Формат ошибки `{error:{code,message,details,requestId}}`, без stack/SQL/внутренних URL | ✅ | `test_idempotency_admin.py::test_error_shape_and_no_stack_leak` |
| 6.8 | Rate limit admin ≥ 60 req/min → 429 | ✅ | `test_idempotency_admin.py::test_admin_rate_limit_429` |
| 6.9 | Ответы `{data}`; списки page/pageSize≤100/sort/filter | ✅ | покрывается всеми list-тестами |

## 7. Frontend

| № | Критерий | Статус | Доказательство |
|---|----------|--------|----------------|
| 7.1 | Вход (email+пароль), MFA-шаг, отдельный admin-токен | ✅ | vitest `AdminLoginPage` (4 теста) |
| 7.2 | Nav по ролям; 403 → inline-баннер; 401 → step-up/login | ✅ | vitest `AdminLayout` (4 теста) |
| 7.3 | Критичные действия — из клавиатуры + явное подтверждение (ConfirmDialog) | ✅ | vitest `ConfirmDialog` (4), `UsersPage` block-flow (3) |
| 7.4 | Базовый WCAG 2.1 AA: aria-роли, focus, labels, русский | ✅ | vitest (роли/labels) + ручной smoke |
| 7.5 | E2E-сценарии 12.3 воспроизводимы вручную | ✅ | живой smoke-test (см. §8) |

## 8. Ручной smoke-test (живая dev-среда, 2026-10-05)

Выполнен в этой сессии: backend (uvicorn :8000, sqlite) + Vite (:3000, proxy
`/api`→:8000), seed `seed_admin.py --with-demo-data`.

- `root@fittrack.demo` (SUPER_ADMIN): логин → dashboard-виджеты → users
  (masked email, BLOCKED-статус) → billing/payments (maske tx id) → audit → exports. ✅
- `content@fittrack.demo` (CONTENT_MANAGER): логин → меню без users/billing;
  `GET /admin/users` → 403. ✅
- `admin@fittrack.demo` (ADMIN): логин, разделы контента. ✅
- `curl /admin/*` без токена → 401. ✅

## 9. Нагрузка и производительность (11.7)

| № | Критерий | Статус | Примечание |
|---|----------|--------|------------|
| 9.1 | p95 < 300 мс (типичный admin-запрос, 100 RPS) | ⚠️ | Не выполняется в песочнице (нет load-генератора и production-БД). По плану: «требует production-окружения» |
| 9.2 | Отсутствие N+1-запросов на списках | ⚠️ | Качественно: list-эндпоинты делают count + один select (без per-row запросов); верификация EXPLAIN/логированием — в production |

## 10. Отчётность

- Миграции: `0002_admin_panel_spec_011` верифицирована с пустой БД и с
  «прод-подобной» БД в состоянии 0001: upgrade → parity с `Base.metadata`
  (колонки + индексы), downgrade → чистое состояние 0001, re-upgrade стабилен.
- OpenAPI: `docs/openapi-admin.json` (58 admin-путей, 34 схемы), скрипт
  `backend/scripts/export_openapi_admin.py` для CI-diff.
- Тесты: backend pytest **80/80** (58 admin + клиентские), frontend vitest **25/25**.
