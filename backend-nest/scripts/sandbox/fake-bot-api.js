// Sandbox-only Telegram Bot API test double. Records calls; GET /__calls returns them, POST /__fail/<method> makes next call fail.
const http = require('http');
const calls = []; const failNext = new Set();
http.createServer((req, res) => {
  let body = ''; req.on('data', c => (body += c)); req.on('end', () => {
    if (req.url === '/__calls') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(calls)); }
    if (req.url.startsWith('/__fail/')) { failNext.add(req.url.slice(8)); return res.end('ok'); }
    const m = req.url.match(/^\/bot[^/]+(?:\/test)?\/(\w+)$/); const method = m ? m[1] : '?';
    const payload = body ? JSON.parse(body) : {}; calls.push({ method, payload, at: Date.now() });
    res.setHeader('content-type', 'application/json');
    if (failNext.delete(method)) { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, description: 'forced' })); }
    res.end(JSON.stringify({ ok: true, result: method === 'createInvoiceLink' ? `https://t.me/$fake_${calls.length}` : true }));
  });
}).listen(8081, '127.0.0.1', () => console.log('fake bot api on 8081'));
