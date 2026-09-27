// SPEC-010 black-box acceptance run against a live API + fake Bot API + real Postgres (sandbox only).
// Usage: set -a; . ./.env; set +a; node scripts/sandbox/acceptance.js [--phase=main|expiry]
const crypto = require('crypto');
const { Client } = require('pg');
const API = process.env.API_URL || 'http://127.0.0.1:3000';
const BOT = process.env.TELEGRAM_API_BASE_URL || 'http://127.0.0.1:8081';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WH = `${API}/api/v1/webhooks/telegram/${process.env.TELEGRAM_WEBHOOK_SECRET}`;
const WH_HDR = process.env.TELEGRAM_WEBHOOK_HEADER_SECRET;
const results = [];
const check = (id, desc, ok, info) => { results.push({ id, desc, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${desc}${!ok && info !== undefined ? ' :: ' + JSON.stringify(info).slice(0, 400) : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let db;
const q = async (sql, params) => (await db.query(sql, params)).rows;
const key = () => crypto.randomBytes(16).toString('hex');
let updateSeq = Math.floor(Date.now() / 1000) * 1000;

async function http(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, data: json && json.data, code: json && json.error && json.error.code };
}
function initData(user) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAA' + user.id, user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}
async function login(tgUser) {
  const r = await http('POST', '/api/v1/auth/telegram', { body: { initData: initData(tgUser) } });
  if (r.status >= 300) throw new Error('login failed ' + JSON.stringify(r.body));
  const d = r.data; return { token: d.accessToken || d.tokens?.accessToken, userId: d.user?.id, tg: tgUser };
}
async function grantRole(userId, code) {
  await q(`INSERT INTO "Role"("id","code","name") VALUES (gen_random_uuid(),$1,$1) ON CONFLICT ("code") DO NOTHING`, [code]);
  await q(`INSERT INTO "UserRole"("userId","roleId") SELECT $1::uuid,"id" FROM "Role" WHERE "code"=$2 ON CONFLICT DO NOTHING`, [userId, code]);
}
const botCalls = async () => (await fetch(`${BOT}/__calls`)).json();
const webhook = async (update, { secretUrl = WH, hdr = WH_HDR } = {}) => (await fetch(secretUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...(hdr ? { 'x-telegram-bot-api-secret-token': hdr } : {}) }, body: JSON.stringify(update) })).status;
async function invoice(u, planCode, k = key()) {
  const before = (await botCalls()).length;
  const r = await http('POST', '/api/v1/subscriptions/invoices', { token: u.token, body: { planCode }, headers: { 'Idempotency-Key': k } });
  const call = (await botCalls()).slice(before).find(c => c.method === 'createInvoiceLink');
  return { r, k, payload: call && call.payload.payload, call };
}
async function preCheckout(u, payload, amount, currency = 'XTR', fromId = u.tg.id) {
  const qid = 'pcq_' + key(); const before = (await botCalls()).length;
  const st = await webhook({ update_id: ++updateSeq, pre_checkout_query: { id: qid, from: { id: fromId, is_bot: false, first_name: 'x' }, currency, total_amount: amount, invoice_payload: payload } });
  await sleep(150);
  const ans = (await botCalls()).slice(before).find(c => c.method === 'answerPreCheckoutQuery' && c.payload.pre_checkout_query_id === qid);
  return { st, ok: ans ? ans.payload.ok : undefined };
}
async function pay(u, payload, amount, charge = 'stxCHARGE' + key(), updateId = ++updateSeq, recurring = true) {
  const sub = recurring ? { subscription_expiration_date: Math.floor(Date.now() / 1000) + 30 * 86400, is_recurring: true, is_first_recurring: true } : {};
  const st = await webhook({ update_id: updateId, message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: u.tg.id, type: 'private' }, from: { id: u.tg.id, is_bot: false, first_name: 'x' }, successful_payment: { currency: 'XTR', total_amount: amount, invoice_payload: payload, telegram_payment_charge_id: charge, provider_payment_charge_id: '', ...sub } } });
  await sleep(200); return { st, charge, updateId };
}
const me = async u => (await http('GET', '/api/v1/subscriptions/me', { token: u.token })).data;

async function main() {
  db = new Client(process.env.DATABASE_URL); await db.connect();
  const phase = (process.argv.find(a => a.startsWith('--phase=')) || '--phase=main').split('=')[1];
  if (phase === 'expiry') return expiryPhase();
  const base = Date.now() % 1e9;
  const A = await login({ id: base + 1, first_name: 'Alice', username: 'alice_e2e' });
  const B = await login({ id: base + 2, first_name: 'Bob' });
  let T = await login({ id: base + 3, first_name: 'Trainer' });
  let ADM = await login({ id: base + 4, first_name: 'Admin' });
  const X = await login({ id: base + 5, first_name: 'Blocked' });
  await grantRole(T.userId, 'TRAINER'); T = await login(T.tg);
  await grantRole(ADM.userId, 'ADMIN'); ADM = await login(ADM.tg);

  // --- Plans & /me (FREE) ---
  const plans = await http('GET', '/api/v1/subscriptions/plans', { token: A.token });
  const list = plans.data?.plans || plans.data?.items || plans.data;
  check('AC-01', 'GET /subscriptions/plans → 200, published plans, integer Stars, XTR', plans.status === 200 && Array.isArray(list) && list.length >= 2 && list.every(p => Number.isInteger(p.amountStars) && p.amountStars >= 1 && p.amountStars <= 2_500_000 && p.currency === 'XTR'), plans.body);
  check('AC-01b', 'plans без auth → 401', (await http('GET', '/api/v1/subscriptions/plans')).status === 401);
  const pro = list.find(p => p.code === 'PRO_MONTHLY');
  const tList = (await http('GET', '/api/v1/subscriptions/plans', { token: T.token })).data?.plans || [];
  const tpro = tList.find(p => p.code === 'TRAINER_PRO_MONTHLY');
  check('AC-01c', 'TRAINER_PRO виден тренеру и скрыт от обычного пользователя', !!tpro && !list.some(p => p.code === 'TRAINER_PRO_MONTHLY'), { user: list.map(p => p.code), trainer: tList.map(p => p.code) });
  const m0 = await me(A);
  check('AC-02', '/subscriptions/me для нового пользователя: FREE (вычисляемый), subscription=null, paywallEligibility', m0?.effectiveTier === 'FREE' && m0.subscription == null && m0.paywallEligibility !== undefined && Array.isArray(m0.entitlements), m0);
  check('AC-02b', 'FREE не хранится в subscriptions', (await q(`select count(*)::int n from subscriptions where user_id=$1`, [A.userId]))[0].n === 0);

  // --- Paywall on a gated feature (soft gating migrated to subscriptions) ---
  const progId = crypto.randomUUID();
  await q(`INSERT INTO "StarterProgram"("id","title","workoutsPerWeek","durationMinutes","isProOnly","status","active","updatedAt") VALUES ($1,'Pro only E2E',3,45,true,'PUBLISHED',true,now())`, [progId]).catch(e => console.log('seed pro program failed:', e.message));
  const gated0 = await http('GET', `/api/v1/programs/${progId}`, { token: A.token });
  check('AC-03', 'FREE → Pro-контент: 403 ENTITLEMENT_REQUIRED + paywallContext', gated0.status === 403 && gated0.code === 'ENTITLEMENT_REQUIRED', gated0.body);

  // --- Invoice validation ---
  let r = await http('POST', '/api/v1/subscriptions/invoices', { token: B.token, body: { planCode: 'PRO_MONTHLY' } });
  check('AC-04', 'invoice без Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', r.status === 400 && r.code === 'IDEMPOTENCY_KEY_REQUIRED', r.body);
  r = await http('POST', '/api/v1/subscriptions/invoices', { token: B.token, body: { planCode: 'PRO_MONTHLY' }, headers: { 'Idempotency-Key': 'short' } });
  check('AC-05', 'Idempotency-Key < 16 символов → 400', r.status === 400, r.body);
  r = await http('POST', '/api/v1/subscriptions/invoices', { token: B.token, body: { planCode: 'PRO_MONTHLY' }, headers: { 'Idempotency-Key': 'k'.repeat(129) } });
  check('AC-05b', 'Idempotency-Key > 128 символов → 400', r.status === 400, r.body);
  r = await http('POST', '/api/v1/subscriptions/invoices', { token: B.token, body: { planCode: 'PRO_MONTHLY', amountStars: 1 }, headers: { 'Idempotency-Key': key() } });
  check('AC-06', 'в теле только planCode (цена с клиента) → 400 VALIDATION_ERROR', r.status === 400 && r.code === 'VALIDATION_ERROR', r.body);
  r = await http('POST', '/api/v1/subscriptions/invoices', { token: B.token, body: { planCode: 'NOPE_PLAN' }, headers: { 'Idempotency-Key': key() } });
  check('AC-07', 'неизвестный план → 404 PLAN_NOT_FOUND', r.status === 404 && r.code === 'PLAN_NOT_FOUND', r.body);
  r = await http('POST', '/api/v1/subscriptions/invoices', { token: A.token, body: { planCode: 'TRAINER_PRO_MONTHLY' }, headers: { 'Idempotency-Key': key() } });
  check('AC-08', 'TRAINER_PRO без роли TRAINER → 403 TRAINER_ROLE_REQUIRED', r.status === 403 && r.code === 'TRAINER_ROLE_REQUIRED', r.body);

  const inv1 = await invoice(A, 'PRO_MONTHLY');
  check('AC-09', 'invoice → 201, invoiceLink, paymentId, PENDING, сумма из плана', inv1.r.status === 201 && inv1.r.data?.invoiceLink && inv1.r.data?.paymentId && inv1.r.data?.amountStars === pro.amountStars, inv1.r.body);
  check('AC-10', 'createInvoiceLink: currency XTR, provider_token пустой, сумма = цене плана, subscription_period 30 дней', inv1.call && inv1.call.payload.currency === 'XTR' && inv1.call.payload.provider_token === '' && inv1.call.payload.prices[0].amount === pro.amountStars && inv1.call.payload.subscription_period === 2592000, inv1.call);
  const payRow = (await q(`select * from payments where id=$1`, [inv1.r.data.paymentId]))[0];
  check('AC-11', 'invoice_payload непрозрачный случайный, в БД только hash', inv1.payload && inv1.payload.length >= 32 && !inv1.payload.includes(A.userId) && payRow.invoice_payload_hash === crypto.createHash('sha256').update(inv1.payload).digest('hex') && !JSON.stringify(payRow).includes(inv1.payload), { payload: inv1.payload });
  const again = await http('POST', '/api/v1/subscriptions/invoices', { token: A.token, body: { planCode: 'PRO_MONTHLY' }, headers: { 'Idempotency-Key': inv1.k } });
  check('AC-12', 'повтор с тем же ключом → тот же платёж, без нового invoice', again.status === 201 && again.data?.paymentId === inv1.r.data.paymentId, again.body);
  const reuse = await http('POST', '/api/v1/subscriptions/invoices', { token: A.token, body: { planCode: 'PRO_QUARTERLY' }, headers: { 'Idempotency-Key': inv1.k } });
  check('AC-13', 'тот же ключ + другое тело → 409 IDEMPOTENCY_KEY_REUSED', reuse.status === 409 && reuse.code === 'IDEMPOTENCY_KEY_REUSED', reuse.body);

  // --- Webhook security ---
  check('AC-14', 'webhook с неверным секретом → 404, пустое тело', await webhook({ update_id: ++updateSeq }, { secretUrl: `${API}/api/v1/webhooks/telegram/wrong-secret` }) === 404);
  check('AC-14b', 'webhook с неверным X-Telegram-Bot-Api-Secret-Token → отказ', (await webhook({ update_id: ++updateSeq }, { hdr: 'bad' })) >= 400);

  // --- pre_checkout_query ---
  check('AC-15', 'pre_checkout: верные payload/user/XTR/сумма → ok=true', (await preCheckout(A, inv1.payload, pro.amountStars)).ok === true);
  check('AC-16', 'pre_checkout: неверная сумма → ok=false', (await preCheckout(A, inv1.payload, pro.amountStars + 1)).ok === false);
  check('AC-17', 'pre_checkout: чужой пользователь → ok=false', (await preCheckout(A, inv1.payload, pro.amountStars, 'XTR', B.tg.id)).ok === false);
  check('AC-18', 'pre_checkout: валюта не XTR → ok=false', (await preCheckout(A, inv1.payload, pro.amountStars, 'USD')).ok === false);
  check('AC-19', 'pre_checkout: неизвестный payload → ok=false', (await preCheckout(A, 'x'.repeat(40), pro.amountStars)).ok === false);

  // --- successful_payment ---
  const t0 = Date.now();
  const p1 = await pay(A, inv1.payload, pro.amountStars);
  check('AC-20', 'successful_payment → webhook 200', p1.st === 200);
  const m1 = await me(A); const s1 = m1?.subscription;
  const endMs = s1 && new Date(s1.currentPeriodEnd).getTime();
  check('AC-21', 'после оплаты /me: PRO, ACTIVE, autoRenew, период = period_days', m1?.effectiveTier === 'PRO' && s1?.status === 'ACTIVE' && s1?.autoRenew === true && Math.abs(endMs - (t0 + pro.periodDays * 864e5)) < 120_000, m1);
  const pr = (await q(`select status, telegram_payment_charge_id, paid_at from payments where id=$1`, [inv1.r.data.paymentId]))[0];
  check('AC-22', 'payment → PAID, charge id сохранён', pr.status === 'PAID' && pr.telegram_payment_charge_id === p1.charge, pr);
  check('AC-23', 'entitlements выданы (user_entitlements)', (await q(`select count(*)::int n from user_entitlements where user_id=$1`, [A.userId]))[0].n > 0);
  const audit = await q(`select * from "AuditLog" where "targetUserId"=$1::uuid or "actorUserId"=$1::uuid`, [A.userId]).catch(() => []);
  check('AC-24', 'audit log записан, без charge id', audit.length > 0 && !JSON.stringify(audit).includes(p1.charge), audit.length);
  const outbox = await q(`select * from "OutboxEvent" where "userId"=$1::uuid`, [A.userId]).catch(async () => q(`select * from "OutboxEvent" where payload::text like $1`, ['%' + A.userId + '%']));
  check('AC-25', 'outbox-событие об оплате/подписке, без charge id', outbox.length > 0 && !JSON.stringify(outbox).includes(p1.charge), outbox.map(o => o.eventType || o.type));
  const gated1 = await http('GET', `/api/v1/programs/${progId}`, { token: A.token });
  check('AC-26', 'после оплаты Pro-контент доступен', gated1.status === 200, gated1.body);

  // --- duplicates ---
  const dupUpd = await webhook({ update_id: p1.updateId, message: { message_id: 1, date: 1, chat: { id: A.tg.id, type: 'private' }, from: { id: A.tg.id, is_bot: false, first_name: 'x' }, successful_payment: { currency: 'XTR', total_amount: pro.amountStars, invoice_payload: inv1.payload, telegram_payment_charge_id: p1.charge, provider_payment_charge_id: '' } } });
  await pay(A, inv1.payload, pro.amountStars, p1.charge); // same charge, new update_id
  const m1b = await me(A);
  check('AC-27', 'повтор update_id и повтор charge id → 200, период не продлён повторно, один PAID', dupUpd === 200 && m1b.subscription.currentPeriodEnd === s1.currentPeriodEnd && (await q(`select count(*)::int n from payments where user_id=$1 and status='PAID'`, [A.userId]))[0].n === 1, m1b.subscription);
  const ev = await q(`select payload::text p from telegram_webhook_events where update_id=$1`, [p1.updateId]);
  check('AC-28', 'webhook-событие сохранено редактированным (без charge id / payload)', ev.length === 1 && !ev[0].p.includes(p1.charge) && !ev[0].p.includes(inv1.payload), ev[0]?.p?.slice(0, 200));

  // --- same plan while auto-renew active → conflict; after cancel → extension ---
  r = await http('POST', '/api/v1/subscriptions/invoices', { token: A.token, body: { planCode: 'PRO_MONTHLY' }, headers: { 'Idempotency-Key': key() } });
  check('AC-29a', 'повторная покупка при активном автопродлении → 409 ACTIVE_SUBSCRIPTION_CONFLICT (нельзя задвоить подписку Telegram)', r.status === 409 && r.code === 'ACTIVE_SUBSCRIPTION_CONFLICT', r.body);
  // --- cancel ---
  r = await http('POST', '/api/v1/subscriptions/me/cancel', { token: B.token, headers: { 'Idempotency-Key': key() } });
  check('AC-37', 'отмена без подписки → 404 ACTIVE_SUBSCRIPTION_NOT_FOUND', r.status === 404 && r.code === 'ACTIVE_SUBSCRIPTION_NOT_FOUND', r.body);
  r = await http('POST', '/api/v1/subscriptions/me/cancel', { token: A.token, headers: { 'Idempotency-Key': key() } });
  const mc = await me(A);
  check('AC-38', 'отмена → EXPIRING, autoRenew=false, доступ до currentPeriodEnd', r.status === 200 && mc.subscription.status === 'EXPIRING' && mc.subscription.autoRenew === false && mc.effectiveTier === 'PRO' && mc.subscription.currentPeriodEnd === s1.currentPeriodEnd, { r: r.body, mc });
  r = await http('POST', '/api/v1/subscriptions/me/cancel', { token: A.token, headers: { 'Idempotency-Key': key() } });
  check('AC-39', 'повторная отмена → 200 идемпотентно или 409 CANCELLATION_NOT_SUPPORTED', r.status === 200 || (r.status === 409 && r.code === 'CANCELLATION_NOT_SUPPORTED'), r.body);

  // --- extension after cancel (autoRenew=false) ---
  const inv2 = await invoice(A, 'PRO_MONTHLY');
  check('AC-29', 'покупка того же плана при активной подписке разрешена (продление)', inv2.r.status === 201, inv2.r.body);
  await preCheckout(A, inv2.payload, pro.amountStars); await pay(A, inv2.payload, pro.amountStars, undefined, undefined, false);
  const m2 = await me(A);
  check('AC-30', 'продление ровно на period_days от текущего конца периода', new Date(m2.subscription.currentPeriodEnd).getTime() - endMs === pro.periodDays * 864e5 && (await q(`select count(*)::int n from subscriptions where user_id=$1 and status in ('ACTIVE','EXPIRING')`, [A.userId]))[0].n === 1, m2.subscription);

  // --- trainer ---
  const invT = await invoice(T, 'TRAINER_PRO_MONTHLY');
  check('AC-31', 'TRAINER покупает TRAINER_PRO_MONTHLY → 201', invT.r.status === 201, invT.r.body);
  await preCheckout(T, invT.payload, tpro.amountStars); await pay(T, invT.payload, tpro.amountStars);
  const mT = await me(T);
  check('AC-32', 'тренер → effectiveTier TRAINER_PRO', mT?.effectiveTier === 'TRAINER_PRO', mT);
  r = await http('POST', '/api/v1/subscriptions/invoices', { token: T.token, body: { planCode: 'PRO_MONTHLY' }, headers: { 'Idempotency-Key': key() } });
  check('AC-33', 'TRAINER_PRO → PRO: 422 PLAN_CHANGE_NOT_SUPPORTED', r.status === 422 && r.code === 'PLAN_CHANGE_NOT_SUPPORTED', r.body);

  // --- payments history ---
  const hist = await http('GET', '/api/v1/payments', { token: A.token });
  const items = hist.data?.items || [];
  check('AC-34', 'GET /payments: только свои, без charge id', hist.status === 200 && items.length >= 2 && items.every(i => i.userId === undefined || i.userId === A.userId) && !JSON.stringify(hist.body).includes(p1.charge), hist.body);
  const h1 = await http('GET', '/api/v1/payments?limit=1', { token: A.token });
  const cursor = h1.data?.nextCursor;
  const h2 = cursor ? await http('GET', `/api/v1/payments?limit=1&cursor=${encodeURIComponent(cursor)}`, { token: A.token }) : null;
  check('AC-35', 'cursor-пагинация работает', h1.data?.items?.length === 1 && cursor && h2?.data?.items?.[0]?.id !== h1.data.items[0].id, { h1: h1.body, h2: h2?.body });
  check('AC-36', 'limit > 100 → 400', (await http('GET', '/api/v1/payments?limit=101', { token: A.token })).status === 400);
  check('AC-36b', 'чужие платежи не видны (B пусто)', ((await http('GET', '/api/v1/payments', { token: B.token })).data?.items || []).length === 0);

  // --- refund ---
  const payId = inv1.r.data.paymentId;
  r = await http('POST', `/api/v1/admin/payments/${payId}/refund`, { token: A.token, body: { reason: 'USER_REQUEST' }, headers: { 'Idempotency-Key': key() } });
  check('AC-40', 'refund не-админом → 403', r.status === 403, r.body);
  r = await http('POST', `/api/v1/admin/payments/${payId}/refund`, { token: ADM.token, body: { reason: 'USER_REQUEST' } });
  check('AC-41', 'refund без Idempotency-Key → 400', r.status === 400, r.body);
  r = await http('POST', `/api/v1/admin/payments/${payId}/refund`, { token: ADM.token, body: {}, headers: { 'Idempotency-Key': key() } });
  check('AC-41b', 'refund без reason → 400 VALIDATION_ERROR', r.status === 400, r.body);
  const rk = key(); const beforeRef = (await botCalls()).filter(c => c.method === 'refundStarPayment').length;
  r = await http('POST', `/api/v1/admin/payments/${payId}/refund`, { token: ADM.token, body: { reason: 'USER_REQUEST' }, headers: { 'Idempotency-Key': rk } });
  check('AC-42', 'refund → 202 REFUND_PENDING, без charge id в ответе', r.status === 202 && r.data?.payment?.status === 'REFUND_PENDING' && !JSON.stringify(r.body).includes(p1.charge), r.body);
  await sleep(1500);
  const r2 = await http('POST', `/api/v1/admin/payments/${payId}/refund`, { token: ADM.token, body: { reason: 'USER_REQUEST' }, headers: { 'Idempotency-Key': rk } });
  const r3 = await http('POST', `/api/v1/admin/payments/${payId}/refund`, { token: ADM.token, body: { reason: 'USER_REQUEST' }, headers: { 'Idempotency-Key': key() } });
  const refCalls = (await botCalls()).filter(c => c.method === 'refundStarPayment');
  check('AC-43', 'повтор refund идемпотентен: Telegram вызван ровно 1 раз', r2.status === 202 && r3.status < 500 && refCalls.length - beforeRef === 1, { r2: r2.body, r3: r3.body, calls: refCalls.length - beforeRef });
  const prRef = (await q(`select status from payments where id=$1`, [payId]))[0];
  const mr = await me(A);
  check('AC-44', 'после возврата payment REFUNDED, права пересчитаны', prRef.status === 'REFUNDED', { prRef, mr });
  check('AC-44b', 'возврат отзывает доступ по возвращённому периоду (остаётся только оплаченный второй платёж или FREE)', mr.effectiveTier === 'FREE' || new Date(mr.subscription.currentPeriodEnd).getTime() < new Date(m2.subscription.currentPeriodEnd).getTime(), mr);
  const mB = await me(B);
  check('AC-45', 'права другого пользователя не затронуты', mB.effectiveTier === 'FREE');

  // --- inactive user ---
  const invX = await invoice(X, 'PRO_MONTHLY');
  await q(`update "User" set status='BLOCKED' where id=$1::uuid`, [X.userId]);
  r = await http('POST', '/api/v1/subscriptions/invoices', { token: X.token, body: { planCode: 'PRO_MONTHLY' }, headers: { 'Idempotency-Key': key() } });
  check('AC-46', 'неактивный пользователь: invoice → 403 ACCOUNT_INACTIVE (или 401 отказ auth)', (r.status === 403 && r.code === 'ACCOUNT_INACTIVE') || r.status === 401, r.body);
  check('AC-47', 'pre_checkout неактивного → ok=false', (await preCheckout(X, invX.payload, pro.amountStars)).ok === false);
  await pay(X, invX.payload, pro.amountStars);
  const px = (await q(`select status, requires_manual_review from payments where user_id=$1`, [X.userId]))[0];
  const sx = await q(`select * from subscriptions where user_id=$1 and status in ('ACTIVE','EXPIRING')`, [X.userId]);
  check('AC-48', 'оплата неактивного записана, доступ не выдан (manual review)', px && px.requires_manual_review === true && sx.length === 0, px);

  // --- metrics / admin list ---
  const met = await http('GET', '/api/v1/admin/subscriptions/metrics', { token: ADM.token });
  check('AC-49', 'метрики доступны админу', met.status === 200 && /payment|subscription/.test(met.data?.metrics || ''), met.body);
  const adm = await http('GET', '/api/v1/admin/payments', { token: ADM.token });
  check('AC-50', 'admin список платежей без charge id', adm.status === 200 && !JSON.stringify(adm.body).includes(p1.charge), adm.status);

  // --- prepare expiry phase ---
  await q(`update subscriptions set current_period_end = now() - interval '1 minute' where user_id=$1 and status in ('ACTIVE','EXPIRING')`, [T.userId]);
  // --- crash between webhook receipt and business commit: event stored as RECEIVED, never processed ---
  const R = await login({ id: base + 6, first_name: 'Recovery' });
  const invR = await invoice(R, 'PRO_MONTHLY');
  const chargeR = 'stxCHARGE' + key();
  const normalized = { currency: 'XTR', isRecurring: true, totalAmount: pro.amountStars, fromTelegramId: String(R.tg.id), isFirstRecurring: true, invoicePayloadHash: crypto.createHash('sha256').update(invR.payload).digest('hex'), providerPaymentChargeId: '', telegramPaymentChargeId: chargeR, subscriptionExpirationDate: null };
  await q(`insert into telegram_webhook_events(id, update_id, event_type, payload, payload_hash, status, attempts, created_at) values (gen_random_uuid(), $1, 'successful_payment', $2::jsonb, $3, 'RECEIVED', 0, now() - interval '1 minute')`, [++updateSeq, JSON.stringify(normalized), crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex')]);
  require('fs').writeFileSync('/tmp/spec010-expiry.json', JSON.stringify({ T, R, recoveryPaymentId: invR.r.data.paymentId }));
  await finish();
}

async function expiryPhase() {
  const { T, R, recoveryPaymentId } = JSON.parse(require('fs').readFileSync('/tmp/spec010-expiry.json', 'utf8'));
  const rp = (await q(`select status from payments where id=$1`, [recoveryPaymentId]))[0];
  const mR = await me(R);
  check('AC-54', 'recovery после рестарта: сохранённое RECEIVED-событие дообработано → PAID, PRO', rp?.status === 'PAID' && mR?.effectiveTier === 'PRO', { rp, tier: mR?.effectiveTier });
  const s = await q(`select status, expired_at from subscriptions where user_id=$1 order by created_at desc limit 1`, [T.userId]);
  check('AC-51', 'job истечения: просроченная подписка → EXPIRED', s[0]?.status === 'EXPIRED', s);
  const m = await me(T);
  check('AC-52', 'после истечения effectiveTier = FREE', m?.effectiveTier === 'FREE', m);
  const ob = await q(`select "type" from "OutboxEvent" where "type"='subscription.expired' and ("userId"=$1::uuid or payload::text like $2)`, [T.userId, '%' + T.userId + '%']).catch(e => [{ err: e.message }]);
  check('AC-53', 'outbox subscription.expired записан', JSON.stringify(ob).includes('subscription.expired'), ob.length);
  await finish();
}
async function finish() {
  await db.end();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
}
main().catch(e => { console.error(e); process.exit(2); });
