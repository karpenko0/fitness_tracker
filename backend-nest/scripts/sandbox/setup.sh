#!/usr/bin/env bash
# Sandbox-only bootstrap (no Prisma engine binaries / apt available). Idempotent.
set -e
BE="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$BE"
[ -d node_modules/@nestjs ] || npm ci --ignore-scripts --no-audit --no-fund
npm i --no-save --ignore-scripts @prisma/adapter-pg@5.22.0 pg embedded-postgres >/dev/null 2>&1
( cd node_modules/argon2 && M=$PWD/lib/binding/napi-v3 && [ -f $M/argon2.node ] || npx -y node-gyp rebuild --nodedir=/usr/local --module_name=argon2 --module_path=$M --napi_build_version=3 >/dev/null 2>&1 )
touch /tmp/fake.so.node /tmp/fake-se; chmod +x /tmp/fake-se
export PRISMA_QUERY_ENGINE_LIBRARY=/tmp/fake.so.node PRISMA_SCHEMA_ENGINE_BINARY=/tmp/fake-se PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
npx prisma generate >/dev/null
sed -e 's#provider = "prisma-client-js"#provider = "prisma-client-js"\n  previewFeatures = ["driverAdapters"]\n  output = "'$BE'/node_modules/.prisma-adapter-client"#' prisma/schema.prisma > prisma/.adapter.tmp.prisma
npx prisma generate --schema prisma/.adapter.tmp.prisma >/dev/null; rm prisma/.adapter.tmp.prisma
node -e "
const f='$BE/node_modules/.prisma-adapter-client/wasm.js';const fs=require('fs');let s=fs.readFileSync(f,'utf8');
s=s.replace(/getQueryEngineWasmModule: async \(\) => \{[\s\S]*?return engine \n  \}/, \"getQueryEngineWasmModule: async () => new WebAssembly.Module(require('fs').readFileSync(require('path').join(__dirname,'query_engine_bg.wasm')))\");
fs.writeFileSync(f,s)"
if [ ! -x /tmp/pg/bin/postgres ]; then
  mkdir -p /tmp/pg && cp -r node_modules/@embedded-postgres/linux-x64/native/* /tmp/pg/ && chmod +x /tmp/pg/bin/*
  (cd /tmp/pg && node -e "const fs=require('fs'),p=require('path');for(const x of require('./pg-symlinks.json')){try{fs.symlinkSync(p.basename(x.source),x.target.replace('native/',''))}catch(e){}}")
  echo postgres > /tmp/pw && /tmp/pg/bin/initdb -D /tmp/pg/data -U postgres --pwfile=/tmp/pw -A md5 >/dev/null 2>&1
fi
echo "setup ok. Start DB: /tmp/pg/bin/postgres -D /tmp/pg/data -p 5432 -k /tmp ; migrate: node scripts/sandbox/migrate.js <url>"
