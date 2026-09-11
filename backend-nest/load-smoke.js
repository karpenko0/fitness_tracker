const http = require('http');
const url = new URL(process.env.DASHBOARD_URL || 'http://localhost:8000/api/v1/dashboard');
const total = Number(process.env.LOAD_REQUESTS || 100);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 20);
const token = process.env.ACCESS_TOKEN;
if (!token) { console.error('ACCESS_TOKEN is required'); process.exit(2); }
let next = 0; let active = 0; let completed = 0; let failed = 0; const times = [];
function run() {
  while (active < concurrency && next < total) {
    next++; active++; const started = Date.now();
    const req = http.request({ hostname: url.hostname, port: url.port || 80, path: `${url.pathname}${url.search}`, method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, res => { res.resume(); res.on('end', () => { times.push(Date.now() - started); if (res.statusCode !== 200) failed++; active--; completed++; run(); }); });
    req.on('error', () => { failed++; active--; completed++; run(); }); req.end();
  }
  if (completed === total) { times.sort((a, b) => a - b); const percentile = p => times[Math.min(times.length - 1, Math.floor(times.length * p))]; console.log(JSON.stringify({ total, concurrency, failed, p95: percentile(0.95), p99: percentile(0.99), max: times[times.length - 1] })); process.exit(failed ? 1 : 0); }
}
run();
