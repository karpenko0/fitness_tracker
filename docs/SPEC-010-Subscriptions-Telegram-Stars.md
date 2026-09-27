# SPEC-010. Подписки и Telegram Stars

## 1. Назначение

Модуль управляет тарифами FitTracker Pro, оплатой через Telegram Stars, правами подписки, возвратами и историей финансовых событий. Пользователь получает ценность от базового продукта до показа paywall: завершает онбординг и как минимум начинает или завершает первую тренировку. Покупка не должна быть обязательной для базового сценария Free.

Единственный достоверный источник статуса оплаты и подписки — backend. Клиент Telegram Mini App отображает состояние, но не подтверждает платежи и не назначает права доступа.

### 1.1. Цели MVP

- предоставлять тарифы `FREE`, `PRO`, `TRAINER_PRO`;
- показывать paywall в контексте ценного действия и после достижения минимального порога ценности;
- создавать Telegram Stars invoice для доступного пользователю тарифа;
- принимать и проверять payment updates только через Telegram Bot API webhook;
- активировать, продлевать, отменять, помечать истёкшие и возвращённые подписки;
- хранить историю платежей, подписок и webhook-событий;
- синхронизировать entitlements с остальными модулями через backend;
- предотвращать повторную обработку платежей и webhook-обновлений.

### 1.2. Входит в MVP

- каталог тарифов и периодов;
- серверное создание invoice link / invoice payload для Telegram Stars;
- обработка `pre_checkout_query` и `successful_payment`;
- выдача и отзыв прав доступа;
- отмена автопродления, если Telegram предоставляет соответствующий поток;
- получение текущей подписки, прав и истории платежей;
- запрос возврата/обработка подтверждённого возврата через административный backend-процесс;
- аудит, метрики, алерты и журнал webhook-событий;
- ограничения Free и проверки доступа в защищённых модулях.

### 1.3. Не входит в MVP

- оплата банковской картой, Apple Pay, Google Pay, криптовалютой или другим PSP;
- промокоды, подарочные сертификаты, семейные подписки, корпоративные планы;
- частичные возвраты, proration и смена тарифа с перерасчётом;
- самостоятельный биллинг вне Telegram;
- ручное изменение финансового статуса без `audit_logs`;
- показ paywall до онбординга или без действия, дающего пользователю ценность.

## 2. Роли и ответственность

| Роль | Ответственность и права |
|---|---|
| `USER` | Просматривает собственные тарифы, инициирует покупку, видит только свою подписку и платежи, отменяет автопродление при доступности функции. |
| `TRAINER` | Имеет все права `USER`; может приобретать только доступный тариф `TRAINER_PRO`. |
| `ADMIN` | Просматривает платежи, webhooks и подписки через отдельный Admin API; инициирует разрешённый возврат с обязательным аудитом. Не может создавать фиктивные оплаты. |
| `SUPER_ADMIN` | Управляет опубликованными тарифами и ценами, имеет права `ADMIN`; изменения требуют аудита. |
| `SYSTEM` | Обрабатывает webhook, выдаёт/отзывает entitlements, запускает задачу истечения и пишет события. |
| `TELEGRAM_BOT` | Внешний доверенный источник платежных updates после проверки секретного пути webhook и валидации структуры update. |

При создании аккаунта пользователю назначается `FREE`. Тариф `TRAINER_PRO` доступен только пользователю с ролью `TRAINER` либо с подтверждённым тренерским профилем.

## 3. Термины и статусы

### 3.1. Тарифы

| Код | Назначение |
|---|---|
| `FREE` | Базовый доступ с лимитами продукта. Не имеет платежа и даты окончания. |
| `PRO` | Платный доступ для обычного пользователя. |
| `TRAINER_PRO` | Платный доступ для тренера с возможностями тренерского модуля. |

Конкретные лимиты Free и наборы Pro определяются единым каталогом entitlements; другие сервисы не должны хардкодить цены или тарифные правила.

### 3.2. Статусы подписки

| Статус | Значение | Доступ |
|---|---|---|
| `ACTIVE` | Подписка действительна до `current_period_end`. | Соответствующие entitlements доступны. |
| `EXPIRING` | Автопродление отменено, период ещё не завершён. | Доступен до `current_period_end`. |
| `CANCELLED` | Отменена до начала периода либо отменена администратором до активации. | Нет, кроме уже оплаченного активного периода; тогда использовать `EXPIRING`. |
| `EXPIRED` | Оплаченный период завершился без продления. | Нет; действует `FREE`. |
| `REFUNDED` | Платёж полностью возвращён. | Отозвать права немедленно, если они были выданы данным платежом. |

Статус `FREE` не хранить как подписку: это вычисляемый fallback при отсутствии активной или истекающей подписки.

### 3.3. Статусы платежа

`PENDING`, `PAID`, `REFUND_PENDING`, `REFUNDED`, `FAILED`, `CANCELLED`.

Переход в `PAID` возможен только после успешной обработки `successful_payment`. Создание invoice или клиентский callback не являются оплатой.

## 4. User Stories

### US-010-01. Получение ценности до paywall

Как пользователь Free, я хочу сначала воспользоваться приложением, чтобы решение о покупке было осознанным.

### US-010-02. Просмотр тарифа и цены

Как пользователь, я хочу видеть доступные мне тарифы, период, цену в Stars и список преимуществ, чтобы выбрать подходящий вариант.

### US-010-03. Покупка Pro

Как пользователь Free, я хочу оплатить Pro в Telegram Stars, чтобы снять ограничения тарифа.

### US-010-04. Безопасное подтверждение покупки

Как пользователь, я хочу, чтобы доступ открывался только после подтверждённой оплаты, а повторные уведомления не списывали деньги и не продлевали подписку дважды.

### US-010-05. Управление подпиской

Как пользователь, я хочу видеть период действия, статус автопродления и историю платежей, чтобы понимать свой доступ.

### US-010-06. Доступ тренера

Как тренер, я хочу приобрести Trainer Pro, чтобы использовать функции ведения клиентов.

### US-010-07. Возврат

Как администратор, я хочу обработать обоснованный возврат через контролируемый backend-процесс, чтобы финансовый статус и права пользователя были синхронизированы.

## 5. Функциональные сценарии

### 5.1. Показ paywall

1. Клиент получает `GET /api/v1/subscriptions/me` и текущие entitlements.
2. При попытке использовать ограниченную Free-функцию backend возвращает `403 ENTITLEMENT_REQUIRED` с `requiredEntitlement`, `currentPlan` и безопасным `paywallContext`.
3. Клиент показывает paywall только после выполнения как минимум одного условия:
   - пользователь завершил онбординг и начал первую тренировку;
   - пользователь завершил хотя бы одну тренировку;
   - пользователь просмотрел результат/прогресс, для которого требуется Pro.
4. До выполнения условия клиент показывает объяснение лимита без принудительного экрана покупки; ключевая Free-функция остаётся доступной.
5. Клиент запрашивает `GET /api/v1/subscriptions/plans` и отображает только тарифы, доступные роли и региону пользователя.

Paywall — интерфейсный механизм. Backend всегда самостоятельно проверяет entitlement; обход UI не предоставляет доступ.

### 5.2. Создание и оплата invoice

1. Пользователь выбирает опубликованный тариф и период.
2. Клиент вызывает `POST /api/v1/subscriptions/invoices` с `Idempotency-Key`.
3. Backend проверяет JWT, роль, доступность плана, цену и допустимость покупки.
4. Backend создаёт `payments` в статусе `PENDING`, генерирует криптографически случайный opaque `invoice_payload`, связывает его с пользователем, планом, ценой и `Idempotency-Key`.
5. Backend создаёт Telegram invoice в валюте `XTR`; цена в payload клиента не принимается и не доверяется.
6. Backend возвращает `invoiceLink`, `paymentId`, `expiresAt`; клиент открывает инвойс Telegram.
7. Telegram отправляет `pre_checkout_query` на webhook. Backend находит `invoice_payload`, сверяет пользователя Telegram, валюту `XTR`, итоговую сумму, ожидаемый статус и срок invoice.
8. При успешной проверке backend отвечает Telegram `ok=true`; при ошибке — `ok=false` с безопасным сообщением. Нельзя подтверждать pre-checkout, если проверка не прошла.
9. Telegram отправляет `successful_payment` на webhook. Backend сохраняет raw-update в `telegram_webhook_events`, атомарно делает дедупликацию по `update_id` и/или `telegram_payment_charge_id`.
10. В одной транзакции backend меняет `payments.status` на `PAID`, сохраняет Telegram charge IDs, создаёт или продлевает подписку, выдаёт entitlements, записывает `audit_logs` и outbox-событие.
11. Клиент повторно получает `GET /subscriptions/me` либо обновляется через polling; он не активирует тариф на основании `openInvoice` callback.

### 5.3. Продление и истечение

1. При поддерживаемом Telegram подписочном периоде backend хранит `current_period_start`, `current_period_end`, `telegram_subscription_charge_id` и признак автопродления.
2. Каждое подтверждённое продление создаёт новый `payments` и событие, но не дублирует период.
3. Если автопродление отменено, backend переводит активную подписку в `EXPIRING`; доступ сохраняется до окончания периода.
4. Планировщик минимум раз в час переводит просроченные `ACTIVE`/`EXPIRING` подписки в `EXPIRED`, пересчитывает entitlements и публикует `subscription.expired` через transactional outbox.
5. После истечения пользователь получает `FREE`, а данные и история тренировок не удаляются.

### 5.4. Возврат

1. Возврат запускается только через защищённый Admin API и разрешённый Telegram Bot API flow.
2. Администратор указывает `paymentId` и причину; backend проверяет, что платёж принадлежит пользователю, имеет статус `PAID`, ранее не возвращён и разрешён для возврата.
3. Запрос защищён `Idempotency-Key`, создаёт `REFUND_PENDING` и фиксируется в аудите.
4. После подтверждённого результата Telegram backend переводит платёж и подписку в `REFUNDED`, немедленно отзывает entitlements, сохраняет событие и причину.
5. При технической ошибке Telegram платёж не помечается `REFUNDED`; задача возврата отмечается ошибкой и может быть безопасно повторена тем же ключом.

## 6. Бизнес-правила

1. Все деньги указываются только целым количеством Telegram Stars: `amountStars` — целое число от 1 до 2 500 000.
2. Валюта Telegram Stars всегда `XTR`. Любая другая валюта в update отклоняется.
3. Цена, title и план invoice выбираются backend из опубликованного тарифного каталога; клиент не передаёт и не изменяет сумму.
4. В `invoice_payload` запрещено хранить персональные данные, access token, Telegram `initData`, внутренние права или цены в открытом виде. Использовать непрозрачный идентификатор/подписанный серверный payload длиной до ограничения Telegram.
5. `pre_checkout_query` должен быть обработан в срок Telegram; ответ не должен требовать внешних медленных операций. При сомнении в валидности отвечать отказом.
6. Обновления webhook могут приходить повторно, в неверном порядке или быть доставлены после сбоя. Дедупликация по `update_id` обязательна; для финансовой записи уникален `telegram_payment_charge_id`.
7. Повторный `successful_payment` не создаёт второй платёж, второй период и не увеличивает срок повторно.
8. Создание invoice с тем же пользователем и `Idempotency-Key` возвращает тот же незавершённый invoice или исходный результат. Повторный ключ с другим телом возвращает `409 IDEMPOTENCY_KEY_REUSED`.
9. Один пользователь может иметь только одну подписку с доступом `ACTIVE` или `EXPIRING` на один scope продукта. Конкурирующие оплаты сериализуются блокировкой строки подписки или эквивалентной транзакционной защитой.
10. При покупке того же плана до окончания периода применяется понятное правило MVP: продлить `current_period_end` на срок плана. Изменение `PRO` ↔ `TRAINER_PRO` с перерасчётом не поддерживается: вернуть `422 PLAN_CHANGE_NOT_SUPPORTED`.
11. `TRAINER_PRO` недоступен без роли `TRAINER`; backend возвращает `403 TRAINER_ROLE_REQUIRED`.
12. При возврате платежа доступ, выданный этим платежом, отзывается. Если существует другой последующий действительный период, entitlement пересчитывается по актуальной подписке, а не снимается безусловно.
13. Статус оплаты не определяется по UI, данным клиента, локальному времени, скриншоту или `pre_checkout_query`.
14. Все даты хранятся в UTC (`TIMESTAMPTZ`). Отображение периода — в timezone пользователя. Расчёт срока плана выполняется в UTC по серверному времени.
15. Удалённый, заблокированный или деактивированный пользователь не может создавать новые invoices; входящий успешный платёж не должен теряться — он фиксируется и передаётся на ручную обработку без выдачи доступа.
16. Webhook endpoint не использует JWT. Он доступен только Telegram, защищён непредсказуемым `secret_token`/маршрутом, TLS, rate limiting и сетевыми ограничениями, если инфраструктура их поддерживает.
17. Секреты бота, webhook secret и платёжные charge IDs не попадают в клиентские ответы, ошибки, логи и аудит в открытом виде. Допускается маскирование идентификаторов.

## 7. API-контракт

### 7.1. Общие требования

- Базовый префикс: `/api/v1`.
- Формат: `application/json; charset=utf-8`.
- Все пользовательские endpoints требуют `Authorization: Bearer <access_token>`.
- Даты: ISO 8601 UTC.
- Успешный ответ: `{ "data": ... }`.
- Ошибка: `{ "error": { "code", "message", "details", "requestId" } }`.
- Все создающие финансовую операцию POST требуют заголовок `Idempotency-Key`: UUID/opaque строка длиной 16–128 символов.
- Неизвестные поля запроса запрещены.
- Денежные значения передаются целыми числами в Stars, без float.

### 7.2. Формат ошибки

```json
{
  "error": {
    "code": "ENTITLEMENT_REQUIRED",
    "message": "Для этой функции требуется тариф Pro.",
    "details": {
      "currentPlan": "FREE",
      "requiredEntitlement": "UNLIMITED_PROGRAMS"
    },
    "requestId": "req_01J..."
  }
}
```

### 7.3. `GET /subscriptions/plans`

Возвращает опубликованные тарифы, разрешённые текущей роли.

Ответ `200 OK`:

```json
{
  "data": {
    "plans": [
      {
        "code": "PRO_MONTHLY",
        "tier": "PRO",
        "title": "FitTracker Pro — 30 дней",
        "periodDays": 30,
        "amountStars": 399,
        "currency": "XTR",
        "features": ["UNLIMITED_PROGRAMS", "ADVANCED_PROGRESS"],
        "isCurrentPlan": false
      }
    ]
  }
}
```

### 7.4. `GET /subscriptions/me`

Возвращает вычисленное состояние доступа текущего пользователя.

Ответ `200 OK`:

```json
{
  "data": {
    "effectiveTier": "PRO",
    "entitlements": ["UNLIMITED_PROGRAMS", "ADVANCED_PROGRESS"],
    "subscription": {
      "id": "019...",
      "planCode": "PRO_MONTHLY",
      "status": "ACTIVE",
      "autoRenew": true,
      "currentPeriodStart": "2026-09-26T12:00:00.000Z",
      "currentPeriodEnd": "2026-10-26T12:00:00.000Z",
      "cancelledAt": null
    },
    "paywallEligibility": {
      "isEligible": true,
      "valueMilestone": "FIRST_WORKOUT_STARTED"
    }
  }
}
```

### 7.5. `POST /subscriptions/invoices`

Создаёт pending payment и Telegram Stars invoice.

Заголовки:

```text
Authorization: Bearer <access_token>
Content-Type: application/json
Idempotency-Key: 5d745c5e-7d9d-41c9-8b00-1c2de2d0fb22
```

Запрос:

```json
{ "planCode": "PRO_MONTHLY" }
```

Ответ `201 Created`:

```json
{
  "data": {
    "paymentId": "019...",
    "planCode": "PRO_MONTHLY",
    "amountStars": 399,
    "currency": "XTR",
    "status": "PENDING",
    "invoiceLink": "https://t.me/$...",
    "expiresAt": "2026-09-26T12:30:00.000Z"
  }
}
```

Ошибки: `400 VALIDATION_ERROR`, `400 IDEMPOTENCY_KEY_REQUIRED`, `401 UNAUTHORIZED`, `403 ACCOUNT_INACTIVE`, `403 TRAINER_ROLE_REQUIRED`, `404 PLAN_NOT_FOUND`, `409 IDEMPOTENCY_KEY_REUSED`, `409 ACTIVE_SUBSCRIPTION_CONFLICT`, `422 PLAN_CHANGE_NOT_SUPPORTED`, `429 RATE_LIMIT_EXCEEDED`.

### 7.6. `POST /subscriptions/me/cancel`

Отменяет автопродление действующей подписки, не аннулируя оплаченный период.

Заголовок `Idempotency-Key` обязателен.

Ответ `200 OK`: возвращает `subscription.status = EXPIRING`, `autoRenew = false`, `cancelledAt`.

Ошибки: `404 ACTIVE_SUBSCRIPTION_NOT_FOUND`, `409 CANCELLATION_NOT_SUPPORTED`, `409 IDEMPOTENCY_KEY_REUSED`.

### 7.7. `GET /payments`

Возвращает только платежи текущего пользователя. Cursor pagination: `cursor`, `limit` (по умолчанию 20, максимум 100).

Ответ `200 OK`:

```json
{
  "data": {
    "items": [
      {
        "id": "019...",
        "planCode": "PRO_MONTHLY",
        "amountStars": 399,
        "currency": "XTR",
        "status": "PAID",
        "paidAt": "2026-09-26T12:01:10.000Z",
        "refundedAt": null
      }
    ],
    "nextCursor": null,
    "hasMore": false
  }
}
```

### 7.8. `POST /admin/payments/{paymentId}/refund`

Доступ: `ADMIN`, `SUPER_ADMIN`, отдельный Admin API. Инициирует возврат через Telegram Bot API. Не возвращает технические charge IDs.

Запрос:

```json
{ "reason": "DUPLICATE_CHARGE" }
```

Ответ `202 Accepted`: `payment.status = REFUND_PENDING`.

### 7.9. `POST /webhooks/telegram/{webhookSecret}`

Внутренний webhook Telegram Bot API. Не документировать как публичный клиентский endpoint и не требовать Bearer token.

Поведение:

- валидирует секрет, JSON-структуру update и лимит размера тела;
- сохраняет update до бизнес-обработки;
- дедуплицирует `update_id`;
- обрабатывает только ожидаемые типы: `pre_checkout_query`, `message.successful_payment`, поддерживаемые обновления подписок/возвратов;
- возвращает `200` только после надёжной фиксации результата либо передаёт тяжёлую идемпотентную обработку в очередь;
- не раскрывает причину отказа в HTTP-ответе злоумышленнику.

## 8. Модель данных

### 8.1. `subscription_plans`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | UUID | PK |
| `code` | VARCHAR(64) | Unique, immutable (`PRO_MONTHLY`) |
| `tier` | ENUM | `PRO`, `TRAINER_PRO` |
| `title` | VARCHAR(160) | Not null |
| `period_days` | SMALLINT | 1–366 |
| `amount_stars` | INTEGER | > 0 |
| `currency` | CHAR(3) | `XTR` |
| `features` | JSONB | Not null |
| `is_active` | BOOLEAN | Not null |
| `version` | INTEGER | Optimistic lock |
| `created_at`, `updated_at` | TIMESTAMPTZ | Not null |

Изменение цены или периода опубликованного плана создаёт новую версию/новый `code`; уже созданные платежи сохраняют snapshot цены.

### 8.2. `subscriptions`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK users |
| `plan_id` | UUID | FK subscription_plans |
| `status` | ENUM | `ACTIVE`, `EXPIRING`, `CANCELLED`, `EXPIRED`, `REFUNDED` |
| `auto_renew` | BOOLEAN | Not null |
| `current_period_start/end` | TIMESTAMPTZ | Not null для активного периода |
| `cancelled_at`, `expired_at`, `refunded_at` | TIMESTAMPTZ | Nullable |
| `version` | INTEGER | Not null |
| `created_at`, `updated_at` | TIMESTAMPTZ | Not null |

Индексы: `(user_id, status)`, `current_period_end`, partial unique index на один `ACTIVE`/`EXPIRING` subscription для пользователя и product scope.

### 8.3. `payments`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | UUID | PK |
| `user_id`, `plan_id`, `subscription_id` | UUID | FK; subscription nullable до оплаты |
| `status` | ENUM | Смотри раздел 3.3 |
| `amount_stars` | INTEGER | Not null, snapshot |
| `currency` | CHAR(3) | `XTR` |
| `invoice_payload_hash` | CHAR(64) | Unique |
| `telegram_payment_charge_id` | VARCHAR(255) | Unique, nullable до оплаты |
| `provider_payment_charge_id` | VARCHAR(255) | Nullable, encrypted/masked в логах |
| `idempotency_key` | VARCHAR(128) | Unique в `(user_id, operation, idempotency_key)` |
| `paid_at`, `refunded_at` | TIMESTAMPTZ | Nullable |
| `plan_snapshot` | JSONB | Not null |
| `created_at`, `updated_at` | TIMESTAMPTZ | Not null |

### 8.4. `telegram_webhook_events`

| Поле | Тип | Ограничения |
|---|---|---|
| `id` | UUID | PK |
| `update_id` | BIGINT | Unique |
| `event_type` | VARCHAR(64) | Not null |
| `payload` | JSONB | Redacted; без секретов, ограниченный retention |
| `payload_hash` | CHAR(64) | Not null |
| `status` | ENUM | `RECEIVED`, `PROCESSED`, `FAILED`, `IGNORED` |
| `error_code` | VARCHAR(80) | Nullable |
| `processed_at`, `created_at` | TIMESTAMPTZ | Not null |

### 8.5. Дополнительные таблицы

- `idempotency_keys`: ключ, hash запроса, HTTP status, сериализованный безопасный ответ, срок хранения;
- `user_entitlements`: материализованный доступ пользователя, источник subscription, `granted_at`, `expires_at`; допускается вычисление на чтении, но изменения подписки и прав должны быть транзакционными;
- `audit_logs`: actor, action, entity, before/after без секретов, requestId, reason;
- `outbox_events`: события `payment.paid`, `subscription.activated`, `subscription.expired`, `payment.refunded` для других модулей.

### 8.6. Транзакции и консистентность

- При `successful_payment` в одной БД-транзакции: дедупликация webhook, payment, subscription, entitlements, audit log и outbox event.
- Все критичные переходы используют row lock или optimistic locking с `version`.
- Внешний вызов Telegram не держит длительную БД-транзакцию. Результат фиксируется отдельно, затем состояние меняется идемпотентно.
- Raw webhook хранить минимально необходимое время; персональные и технические секреты редактировать/маскировать до сохранения.

## 9. RBAC и защита доступа

| Действие | USER | TRAINER | ADMIN | SUPER_ADMIN | SYSTEM |
|---|---:|---:|---:|---:|---:|
| Смотреть свои планы и права | Да | Да | Да | Да | Да |
| Создать свой invoice Pro | Да | Да | Нет | Нет | Нет |
| Создать свой invoice Trainer Pro | Нет | Да | Нет | Нет | Нет |
| Смотреть свои платежи | Да | Да | Да | Да | Да |
| Отменить своё автопродление | Да | Да | Нет | Нет | Нет |
| Смотреть чужие платежи | Нет | Нет | Только Admin API + аудит | Да | Да |
| Инициировать возврат | Нет | Нет | Да + аудит | Да + аудит | Исполняет |
| Изменять планы и цены | Нет | Нет | Нет | Да + аудит | Нет |
| Обрабатывать Telegram webhook | Нет | Нет | Нет | Нет | Да |

Любая проверка Pro/Trainer Pro выполняется серверным `EntitlementsGuard`. API не должен доверять `tier` из JWT как единственному источнику; права получают из актуальной подписки/entitlements.

## 10. Наблюдаемость и аудит

### 10.1. Структурированные логи

Логи JSON: `timestamp`, `level`, `service`, `module=subscriptions`, `event`, `requestId`, `userId` (если известен), `paymentId`, `subscriptionId`, `webhookUpdateId`, `durationMs`, `errorCode`.

События:

- `subscription.plan.listed`;
- `payment.invoice.created`;
- `payment.pre_checkout.approved` / `payment.pre_checkout.rejected`;
- `payment.successful.received`;
- `payment.paid`;
- `payment.duplicate_ignored`;
- `subscription.activated`, `subscription.expiring`, `subscription.expired`;
- `payment.refund.requested`, `payment.refunded`, `payment.refund.failed`;
- `webhook.invalid_secret`, `webhook.processing_failed`;
- `security.entitlement_denied`.

Запрещено логировать: Bot Token, webhook secret, `initData`, access/refresh token, полный invoice payload, полные charge IDs, персональные платёжные данные.

### 10.2. Метрики

| Метрика | Тип | Labels |
|---|---|---|
| `subscription_invoice_created_total` | Counter | `plan_code`, `tier` |
| `telegram_pre_checkout_total` | Counter | `result`, `reason` |
| `telegram_successful_payment_total` | Counter | `plan_code` |
| `payment_processing_total` | Counter | `status`, `error_code` |
| `payment_duplicate_total` | Counter | `kind` |
| `subscription_active_total` | Gauge | `tier` |
| `subscription_expired_total` | Counter | `tier` |
| `payment_refund_total` | Counter | `result`, `reason` |
| `webhook_processing_duration_seconds` | Histogram | `event_type`, `result` |
| `entitlement_denied_total` | Counter | `entitlement`, `current_tier` |

Алерты: рост `webhook.processing_failed`, неуспешные pre-checkout, очередь не обработанных webhook, резкий рост duplicate events, расхождение `PAID` payment без активных entitlement дольше 5 минут.

### 10.3. Audit logs

Обязательно фиксировать:

- создание invoice;
- подтверждение оплаты и выдачу доступа;
- отмену автопродления;
- истечение подписки;
- запрос и результат возврата;
- изменение тарифа/цены;
- административное чтение чужой платежной истории;
- повторную или отклонённую обработку webhook.

## 11. Критерии приёмки

### 11.1. Позитивные сценарии

- [ ] Given пользователь `FREE` завершил онбординг и начал первую тренировку, when он открывает ограниченную Pro-функцию, then клиент показывает paywall, а backend возвращает `403 ENTITLEMENT_REQUIRED` без раскрытия внутренних данных.
- [ ] Given пользователь ещё не достиг value milestone, when он открывает приложение, then paywall не блокирует базовый путь Free.
- [ ] Given авторизованный пользователь выбирает опубликованный `PRO_MONTHLY`, when вызывает создание invoice с новым `Idempotency-Key`, then backend создаёт один `PENDING` payment с серверной ценой `XTR` и возвращает invoice link.
- [ ] Given тот же ключ и то же тело, when повторяется запрос invoice, then возвращается тот же `paymentId`, без второго pending payment.
- [ ] Given Telegram прислал валидный `pre_checkout_query`, when payload, Telegram user ID, `XTR`, сумма и статус совпадают, then backend отвечает `ok=true` в срок Telegram.
- [ ] Given Telegram прислал `successful_payment`, when он впервые обработан, then за одну транзакцию создаются `PAID` payment, `ACTIVE` subscription, entitlements, audit log и outbox event.
- [ ] Given активная подписка того же плана, when поступает подтверждённое продление, then `current_period_end` увеличивается ровно на `period_days`, а новый payment присутствует в истории.
- [ ] Given пользователь отменяет доступное автопродление, when запрос успешен, then подписка становится `EXPIRING`, а доступ остаётся до `current_period_end`.
- [ ] Given период закончился, when выполняется job истечения, then подписка становится `EXPIRED`, entitlements отзываются и пользователь получает ограничения Free.
- [ ] Given возврат подтверждён Telegram, when backend завершает обработку, then payment и применимая подписка получают `REFUNDED`, а доступ пересчитан немедленно.
- [ ] Given роль `TRAINER`, when пользователь покупает опубликованный `TRAINER_PRO`, then выдаются только entitlements тарифа Trainer Pro.

### 11.2. Негативные и безопасностные сценарии

- [ ] Given клиент передаёт `amountStars`, `currency` или признак `paid`, when создаётся invoice, then DTO отклоняет неизвестные поля либо backend игнорирует их по строгой схеме; серверная цена не меняется.
- [ ] Given пользователь Free без роли `TRAINER`, when запрашивает invoice `TRAINER_PRO`, then получает `403 TRAINER_ROLE_REQUIRED`, payment не создаётся.
- [ ] Given webhook имеет неправильный secret, when отправлен update, then обработка не создаёт payment или подписку, попытка логируется безопасно.
- [ ] Given сумма/валюта/payload в pre-checkout не совпадают с payment, when Telegram ожидает ответ, then backend отвечает `ok=false` и не выдаёт доступ.
- [ ] Given один `successful_payment` доставлен дважды или параллельно, when backend обрабатывает updates, then в БД ровно один payment с `telegram_payment_charge_id`, один период и один набор entitlement.
- [ ] Given один `Idempotency-Key` использован с другим `planCode`, when приходит второй запрос, then API возвращает `409 IDEMPOTENCY_KEY_REUSED`.
- [ ] Given пользователь запрашивает чужой `paymentId`, when обращается к пользовательскому API, then получает `404` или `403` согласно принятой политике без утечки существования объекта.
- [ ] Given `PAID` payment уже возвращён, when admin повторяет refund, then второй возврат во внешний API не отправляется и результат идемпотентен.
- [ ] Given пользователь удалён/заблокирован, when создаёт invoice, then получает `403 ACCOUNT_INACTIVE`; при входящем платеже финансовое событие зафиксировано, но доступ не выдан автоматически.
- [ ] Given webhook-обработчик падает после записи события, when worker повторяет обработку, then итоговое состояние консистентно и дубли не появляются.
- [ ] Given API-ответ, лог или audit record, when он содержит финансовые данные, then Bot Token, webhook secret, `initData` и полные charge IDs отсутствуют.

### 11.3. Производительность и надёжность

- [ ] `GET /subscriptions/me` p95 ≤ 300 ms при нормальной нагрузке без обращения к Telegram.
- [ ] `POST /subscriptions/invoices` p95 ≤ 800 ms без учёта открытия Telegram UI.
- [ ] Обработка валидного `pre_checkout_query` выполняется в пределах SLA Telegram; цель p95 ≤ 2 секунд.
- [ ] Внутренняя обработка successful payment p95 ≤ 5 секунд, а состояние не остаётся `PENDING` после повторной доставки/восстановления worker.
- [ ] При рестарте сервиса все не обработанные `RECEIVED` webhook события безопасно подхватываются и доводятся до терминального статуса.

## 12. План тестирования

### 12.1. Unit-тесты

- валидация `planCode`, Stars amount, `Idempotency-Key`, разрешённых статусных переходов;
- расчёт продления периода на 30/90 дней в UTC;
- правила `ACTIVE` → `EXPIRING` → `EXPIRED` и `PAID` → `REFUND_PENDING` → `REFUNDED`;
- eligibility paywall по value milestones;
- RBAC `TRAINER_PRO`;
- сверка payload, user ID, currency и суммы pre-checkout;
- дедупликация `update_id` и `telegram_payment_charge_id`;
- безопасная сериализация логов и аудит-событий.

### 12.2. Integration-тесты API и БД

- `GET /subscriptions/plans`, `GET /subscriptions/me`, `GET /payments` с ownership и cursor pagination;
- создание invoice и повтор с тем же/другим `Idempotency-Key`;
- отсутствие доверия к цене и статусу, переданным клиентом;
- успешный `pre_checkout_query` и `successful_payment` на зафиксированных Telegram fixture updates;
- конкурентная обработка двух одинаковых webhook updates;
- rollback транзакции при ошибке создания entitlement/audit/outbox;
- job истечения и повторный запуск job;
- отмена автопродления;
- возврат, повтор возврата и ошибка внешнего Telegram adapter;
- Admin RBAC и обязательность audit_logs;
- проверка уникальных ограничений `update_id`, `telegram_payment_charge_id`, idempotency key и активной подписки.

### 12.3. E2E и ручная проверка sandbox Telegram

- новый пользователь: онбординг → первая тренировка → ограниченная функция → paywall → invoice → успешная оплата → обновление `GET /subscriptions/me` → доступ Pro;
- пользователь Trainer: покупка `TRAINER_PRO` и доступ к тренерской функции;
- отмена автопродления с сохранением доступа до даты окончания;
- имитация повторной доставки `successful_payment`;
- сценарий восстановления после рестарта между получением webhook и фиксацией business state;
- возврат в тестовой/допустимой среде Telegram и отзыв доступа;
- проверка, что Mini App не получает access без server-confirmed payment.

## 13. Зависимости, риски и стоп-линии

### Зависимости

- действующий Telegram bot с разрешённой поддержкой Telegram Stars;
- HTTPS endpoint webhook и защищённый secret;
- существующие `users`, `roles`, JWT, `audit_logs`, Redis/rate limiting, transactional outbox;
- модуль entitlements или общий backend guard для Free/Pro ограничений;
- Telegram sandbox/тестовый процесс и production checklist перед публикацией.

### Риски и решения

| Риск | Митигирование |
|---|---|
| Повторные/задержанные webhook | Уникальные ключи, транзакции, idempotent worker. |
| Подмена цены клиентом | Цена только из backend plan catalog; сверка update. |
| Доступ без оплаты | Entitlements выдаёт только `successful_payment` handler. |
| Расхождение платежа и прав | Атомарные transaction + outbox + reconciliation job. |
| Утечка токенов/charge IDs | Redaction, секреты в vault/env, минимальные логи. |
| Ошибочный возврат | RBAC, причина, idempotency, аудит, отдельный Telegram adapter. |

### Стоп-линии перед production

- Не включать production webhook и не создавать реальные invoices без отдельного подтверждения владельца проекта.
- Не выполнять реальный возврат без явного одобрения уполномоченного администратора.
- Не развёртывать, пока не пройдены integration/E2E сценарии оплаты, повторной доставки и восстановления после сбоя.
- Не менять стоимость опубликованного плана «на месте»; создавать новую версию плана.
