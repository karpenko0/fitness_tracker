# SPEC-010 — Подписки и Telegram Stars: план разработки

Статус: реализовано в `backend-nest/src/subscription` (ветка `arena/01a0defb-fitness-tracker`).

## Этап 0. Анализ и решения
| Решение | Обоснование |
|---|---|
| Новый модуль `SubscriptionModule` (NestJS), без изменения публичных контрактов других модулей | изоляция финансовой логики |
| Legacy-таблица `subscription_entitlements` (FREE/PRO лимиты программ) синхронизируется из нового модуля | существующие проверки `EntitlementService` продолжают работать без хардкода цен |
| `FREE` не хранится как подписка — вычисляемый fallback | п. 3.2 спецификации |
| Каталог entitlements — единый файл `subscription.catalog.ts`; цены — только в `subscription_plans` | п. 3.1, бизнес-правило 3 |
| Telegram Bot API за адаптером `TelegramBotClient`; реальные вызовы выключены по умолчанию (`TELEGRAM_PAYMENTS_ENABLED=false`) | стоп-линии: без реальных invoice/возвратов до подтверждения владельца |
| Сериализация конкурентных оплат: optimistic lock (`version`) + partial unique index на ACTIVE/EXPIRING + unique `telegram_payment_charge_id` | бизнес-правила 6, 7, 9 |
| Webhook: сначала фиксация события (`RECEIVED`), затем идемпотентная бизнес-обработка; recovery-воркер добивает `RECEIVED/FAILED` | п. 7.9, 11.3 |

## Этап 1. Модель данных (миграция `20260926120000_subscriptions_stars`)
- enum’ы `SubscriptionTier`, `SubscriptionStatus`, `PaymentStatus`, `WebhookEventStatus`;
- таблицы `subscription_plans`, `subscriptions`, `payments`, `telegram_webhook_events`, `user_entitlements`, `refund_requests`;
- partial unique index `subscriptions_one_access_per_scope` (`status IN ('ACTIVE','EXPIRING')`);
- unique: `update_id`, `telegram_payment_charge_id`, `invoice_payload_hash`, `(user_id, operation, idempotency_key)`;
- CHECK: `amount_stars BETWEEN 1 AND 2500000`, `currency = 'XTR'`, `period_days BETWEEN 1 AND 366`;
- seed опубликованных планов `PRO_MONTHLY`, `PRO_QUARTERLY`, `TRAINER_PRO_MONTHLY`.

## Этап 2. Доменное ядро (чистые функции, `subscription.domain.ts`)
валидация Idempotency-Key / Stars; расчёт периода в UTC; конечные автоматы подписки и платежа;
paywall eligibility; RBAC покупки; сверка pre-checkout; маскирование charge ID; хеширование payload; безопасные логи.

## Этап 3. Сервисы
- `SubscriptionService`: планы, `/me`, invoice (идемпотентность, 409 на reuse), отмена автопродления, история платежей (cursor);
- `EntitlementsService` + `EntitlementsGuard`/`@RequireEntitlement()` — 403 `ENTITLEMENT_REQUIRED` с `paywallContext`;
- `TelegramWebhookService`: секрет (timing-safe), лимит тела, redaction, дедуп `update_id`, `pre_checkout_query`, `successful_payment` (одна транзакция: payment → subscription → entitlements → audit → outbox), `refunded_payment`, неактивный пользователь → `MANUAL_REVIEW` без выдачи прав;
- `RefundService`: Admin API, Idempotency-Key, `REFUND_PENDING` → вызов Telegram вне транзакции → `REFUNDED` + пересчёт прав; ошибка → `FAILED` задачи, безопасный повтор;
- `SubscriptionScheduler`: ежечасное истечение ACTIVE/EXPIRING → EXPIRED + outbox, recovery webhook-событий на старте и по расписанию, reconciliation PAID-без-прав;
- `SubscriptionMetrics`, структурированные JSON-логи (`module=subscriptions`).

## Этап 4. API
`GET /api/v1/subscriptions/plans`, `GET /api/v1/subscriptions/me`, `POST /api/v1/subscriptions/invoices`,
`POST /api/v1/subscriptions/me/cancel`, `GET /api/v1/payments`, `GET /api/v1/admin/payments`,
`POST /api/v1/admin/payments/:paymentId/refund`, `POST /api/v1/webhooks/telegram/:webhookSecret` (скрыт из Swagger).

## Этап 5. Тесты
- unit: доменные правила (п. 12.1);
- сервисные «integration-like» тесты на in-memory Prisma-фейке с транзакциями и unique-ограничениями: идемпотентность invoice, дубли/параллельные webhook, продление ровно на period_days, отмена, истечение и повторный запуск job, возврат/повтор/ошибка адаптера, неактивный пользователь, recovery после падения, отсутствие секретов в логах/аудите.
- E2E в Telegram sandbox — ручной чек-лист ниже (требует бота и HTTPS).

## Этап 6. Стоп-линии (не выполнялось автоматически)
- production webhook не регистрируется, `TELEGRAM_PAYMENTS_ENABLED=false` по умолчанию;
- реальные возвраты — только после явного одобрения;
- изменение цены — только новым планом (`code`/`version`), UPDATE цены запрещён триггером.

## Ручной чек-лист sandbox
1. онбординг → первая тренировка → ограниченная функция → paywall → invoice → оплата → `GET /subscriptions/me` = PRO;
2. TRAINER покупает `TRAINER_PRO_MONTHLY`;
3. отмена автопродления, доступ до `currentPeriodEnd`;
4. повторная доставка `successful_payment`;
5. рестарт между приёмом webhook и бизнес-фиксацией;
6. возврат в тестовой среде и отзыв доступа.

## Этап 7. Приведение схемы и миграций (выполнено)
- `schema.prisma`: удалены 26 дублирующихся моделей/enum’ов и старая версия `Measurement`; добавлены недостающие обратные связи (`User.progressPhotos`, `User.progressAggregates`, `Measurement.values`, `Measurement.photos`); файл переведён из UTF‑16 в UTF‑8; `prisma validate` проходит.
- `20260915180000_programs_catalog`: в начало добавлено идемпотентное создание enum’ов `FitnessGoal`, `ExperienceLevel`, `TrainingLocation` — без этого миграция падала на чистой БД. Где она уже применена, изменение ни на что не влияет.
- Новая `20260926110000_progress_measurements_sync`: таблицы `MeasurementValue`, `ProgressPhoto`, `ProgressAggregate` и новые колонки `Measurement` (у них не было миграции). `weightKg` сохранён и перенесён в `MeasurementValue(WEIGHT)`.
- `20260926120000_subscriptions_stars`: id/FK переведены на `UUID` (в БД `User.id` — uuid; с TEXT FK не создавался).
- Проверено на PostgreSQL 17: вся цепочка из 10 миграций применяется на пустой БД; все 47 моделей читаются реальным Prisma Client без ошибок.
- `npm run test:subscriptions:db` (нужен `SUBSCRIPTION_DB_TEST_URL`) — 12 интеграционных тестов на реальной БД.

## Этап 8. Повторная приёмка (живой API + реальный PostgreSQL + тестовый двойник Bot API)
Скрипт: `backend-nest/scripts/sandbox/acceptance.js` (фазы `main` и `expiry` — вторая после рестарта API).
Окружение: `scripts/sandbox/setup.sh`, `migrate.js`, `fake-bot-api.js`, `prisma-adapter-preload.js` (только sandbox;
`TELEGRAM_API_BASE_URL` указывает на двойник, реальные invoice/возвраты не выполняются). Итог: **63/63 PASS**
(59 main + 4 expiry/recovery), плюс 75 unit/service и 12 тестов на реальной БД.

Покрыто: планы (TRAINER_PRO скрыт от не-тренеров), `/me` FREE как вычисляемый; paywall 403 `ENTITLEMENT_REQUIRED`;
все ошибки invoice (400/403/404/409/422) и Idempotency-Key 16–128; `createInvoiceLink` (XTR, пустой provider_token,
subscription_period 30 дней); непрозрачный payload, в БД только hash; секрет webhook (404) и секрет-заголовок;
pre_checkout (сумма/пользователь/валюта/payload/неактивный → ok=false); successful_payment → PAID + ACTIVE +
entitlements + audit + outbox; дубли по update_id и charge id; продление ровно на period_days; TRAINER_PRO и 422;
история платежей (только свои, cursor, limit ≤ 100); отмена → EXPIRING; возврат 202 `REFUND_PENDING` → REFUNDED,
идемпотентность (Telegram вызван 1 раз), пересчёт прав; неактивный пользователь → manual review без доступа;
метрики; истечение → EXPIRED + outbox `subscription.expired`; recovery RECEIVED-события после рестарта;
отсутствие токена/секретов/charge ID в логах, audit и outbox.

Найдено и исправлено при приёмке:
| Проблема | Исправление |
|---|---|
| Авторизация Mini App проверяла initData алгоритмом Login Widget (`sha256(token)`) — реальный вход из Telegram невозможен | `HMAC_SHA256("WebAppData", token)` + timing-safe сравнение |
| `User.status`, `UserProfile.gender/fitnessGoal/experienceLevel/trainingLocation` — TEXT в БД, enum в схеме → вход на чистой БД падал 500 | миграция `20260926130000_user_enum_columns` (идемпотентная) |
| Rate limit по IP: пользователи за одним NAT делили лимит 10 invoice/мин | `UserThrottlerGuard`: ключ — `sub` из проверенного JWT, иначе IP |
| Refund отвечал синхронно `REFUNDED` вместо 202 `REFUND_PENDING` | исполнение асинхронно + retry-job `retryPendingRefunds` (каждые 2 мин, до 5 попыток) |
| Полный `telegram_payment_charge_id` оставался в `telegram_webhook_events` | после терминальной обработки заменяется маской (нужен только для recovery) |
| Непредвиденные 500 не логировались | `HttpExceptionFilter` логирует тип/сообщение с requestId |
| Истечение запускалось только через 15 мин после старта | дополнительный запуск через 5 с после старта |
| `TelegramBotClient` жёстко привязан к api.telegram.org | `TELEGRAM_API_BASE_URL`, `TELEGRAM_TEST_ENV` (тестовая среда Telegram) |

Решение по спецификации: покупка того же плана при **активном автопродлении** → 409 `ACTIVE_SUBSCRIPTION_CONFLICT`
(Telegram создал бы вторую рекуррентную подписку); после отмены (autoRenew=false) — продление на period_days.
