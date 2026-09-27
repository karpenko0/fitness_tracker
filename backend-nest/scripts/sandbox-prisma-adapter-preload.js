// Sandbox-only: redirect @prisma/client to the wasm/driver-adapter build (no engine binaries available).
const Module = require('module');
const path = require('path');
const root = process.env.APP_ROOT || '/home/user/fitness_tracker/backend-nest';
const adapterPath = path.join(root, 'node_modules/.prisma-adapter-client/wasm.js');
const origLoad = Module._load;
let wrapped;
Module._load = function (req, parent, isMain) {
  if (req === '@prisma/client' || req === '.prisma/client' || req === '.prisma/client/default') {
    if (!wrapped) {
      const real = origLoad.call(this, adapterPath, parent, isMain);
      const { Pool } = origLoad.call(this, 'pg', parent, isMain);
      const { PrismaPg } = origLoad.call(this, '@prisma/adapter-pg', parent, isMain);
      class PrismaClient extends real.PrismaClient {
        constructor(opts = {}) {
          super({ ...opts, adapter: opts.adapter || new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })) });
        }
      }
      wrapped = { ...real, PrismaClient };
    }
    return wrapped;
  }
  return origLoad.apply(this, arguments);
};
