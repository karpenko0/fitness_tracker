// Sandbox-only: apply prisma/migrations/*/migration.sql in order (no Prisma engines available offline).
// Usage: node scripts/sandbox/migrate.js <databaseUrl>
const fs = require('fs'); const path = require('path'); const { Client } = require('pg');
(async () => {
  const url = process.argv[2] || process.env.DATABASE_URL;
  const dir = path.join(__dirname, '../../prisma/migrations');
  const c = new Client(url); await c.connect();
  await c.query('create table if not exists "_sandbox_migrations"(name text primary key, applied_at timestamptz default now())');
  const done = new Set((await c.query('select name from "_sandbox_migrations"')).rows.map(r => r.name));
  for (const m of fs.readdirSync(dir).filter(d => fs.existsSync(path.join(dir, d, 'migration.sql'))).sort()) {
    if (done.has(m)) continue;
    await c.query('begin');
    try { await c.query(fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8')); await c.query('insert into "_sandbox_migrations"(name) values($1)', [m]); await c.query('commit'); console.log('applied', m); }
    catch (e) { await c.query('rollback'); console.error('FAILED', m, e.message); process.exit(1); }
  }
  await c.end();
})();
