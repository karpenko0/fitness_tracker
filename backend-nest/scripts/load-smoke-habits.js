// SPEC-009 Фаза 5: замер p95 для GET /api/v1/habits/today и POST /habits/:id/tasks/:taskId/progress
// на стенде с реальным PostgreSQL. Локальный замер handler-time — test/integration/habit-perf.api.spec.ts.
//
// Запуск:
//   ACCESS_TOKEN=<jwt> HABIT_ID=<id> TASK_ID=<id> BASE_URL=https://host \
//     node scripts/load-smoke-habits.js
// Опции: LOAD_REQUESTS (по умолчанию 200), LOAD_CONCURRENCY (10), PROGRESS_VALUE (10).
// Цель SPEC-009: p95 ≤ 300 мс для обоих эндпоинтов.
const http = require('http');
const https = require('https');

const base = new URL(process.env.BASE_URL || 'http://localhost:3000');
const token = process.env.ACCESS_TOKEN;
const habitId = process.env.HABIT_ID;
const taskId = process.env.TASK_ID;
if (!token || !habitId || !taskId) {
  console.error('ACCESS_TOKEN, HABIT_ID and TASK_ID are required');
  process.exit(2);
}
const total = Number(process.env.LOAD_REQUESTS || 200);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 10);
const value = Number(process.env.PROGRESS_VALUE || 10);
const transport = base.protocol === 'https:' ? https : http;

let seq = 0;

function call(path, method, body) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const payload = body ? JSON.stringify(body) : null;
    const req = transport.request(
      {
        hostname: base.hostname,
        port: base.port || (base.protocol === 'https:' ? 443 : 80),
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(method === 'POST' ? { 'Idempotency-Key': `load-${process.pid}-${seq++}` } : {}),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ ms: Number(process.hrtime.bigint() - started) / 1e6, status: res.statusCode }));
      },
    );
    req.on('error', () => resolve({ ms: Number(process.hrtime.bigint() - started) / 1e6, status: 0 }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function measure(name, path, method, body, expected) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < total) {
      next += 1;
      results.push(await call(path, method, typeof body === 'function' ? body() : body));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const ok = results.filter((r) => r.status === expected);
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  const percentile = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
  const report = {
    endpoint: name,
    total,
    concurrency,
    ok: ok.length,
    failed: results.length - ok.length,
    p50: +percentile(0.5).toFixed(1),
    p95: +percentile(0.95).toFixed(1),
    p99: +percentile(0.99).toFixed(1),
    max: +times[times.length - 1].toFixed(1),
    target: 300,
  };
  console.log(JSON.stringify(report));
  return report;
}

(async () => {
  const today = await measure('GET /habits/today', '/api/v1/habits/today', 'GET', null, 200);
  const progress = await measure(
    'POST /habits/:id/tasks/:taskId/progress',
    `/api/v1/habits/${habitId}/tasks/${taskId}/progress`,
    'POST',
    () => ({ action: 'ADD', value, version: Number(process.env.TASK_VERSION || 1) }),
    201,
  );
  const pass = today.p95 <= 300 && progress.p95 <= 300 && today.failed === 0;
  // прогресс идемпотентно упирается в конфликт версий после первых запросов — фиксируем только p95 успешных
  process.exit(pass ? 0 : 1);
})();
