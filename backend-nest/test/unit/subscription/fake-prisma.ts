import { randomUUID } from 'crypto';

/**
 * Минимальный in-memory Prisma для integration-like тестов модуля подписок:
 * транзакции с откатом, сериализация транзакций, unique-ограничения (включая
 * partial unique на ACTIVE/EXPIRING), optimistic updateMany, include-связи.
 */
type Row = Record<string, any>;

interface ModelDef {
  uniques: string[][];
  defaults: () => Row;
  relations?: Record<string, { model: string; fk: string; many?: boolean; ref?: string }>;
  check?: (rows: Row[], row: Row) => boolean;
}

const now = () => new Date();

const MODELS: Record<string, ModelDef> = {
  user: { uniques: [['id'], ['telegramId']], defaults: () => ({ status: 'ACTIVE', deletedAt: null }) },
  role: { uniques: [['id'], ['code']], defaults: () => ({}) },
  userRole: { uniques: [['userId', 'roleId']], defaults: () => ({}), relations: { role: { model: 'role', fk: 'roleId' } } },
  userProfile: { uniques: [['id'], ['userId']], defaults: () => ({ onboardingCompleted: false }) },
  workout: { uniques: [['id']], defaults: () => ({ status: 'PLANNED', startedAt: null }) },
  billingPlan: { uniques: [['id'], ['code']], defaults: () => ({ currency: 'XTR', isActive: true, autoRenewable: false, version: 1 }) },
  subscription: {
    uniques: [['id']],
    defaults: () => ({ productScope: 'FITTRACKER', autoRenew: false, version: 1, cancelledAt: null, expiredAt: null, refundedAt: null, telegramSubscriptionChargeId: null }),
    relations: { plan: { model: 'billingPlan', fk: 'planId' } },
    check: (rows, row) => !['ACTIVE', 'EXPIRING'].includes(row.status)
      || !rows.some(r => r !== row && r.id !== row.id && r.userId === row.userId && r.productScope === row.productScope && ['ACTIVE', 'EXPIRING'].includes(r.status)),
  },
  payment: {
    uniques: [['id'], ['invoicePayloadHash'], ['telegramPaymentChargeId']],
    defaults: () => ({ status: 'PENDING', currency: 'XTR', subscriptionId: null, telegramPaymentChargeId: null, providerPaymentChargeId: null, isRecurring: false, requiresManualReview: false, paidAt: null, refundedAt: null, refundReason: null, invoiceLink: null, version: 1 }),
    relations: { plan: { model: 'billingPlan', fk: 'planId' }, subscription: { model: 'subscription', fk: 'subscriptionId' } },
  },
  telegramWebhookEvent: { uniques: [['id'], ['updateId']], defaults: () => ({ status: 'RECEIVED', attempts: 0, errorCode: null, processedAt: null }) },
  financialIdempotencyKey: { uniques: [['id'], ['userId', 'operation', 'key']], defaults: () => ({ responseStatus: null, responseBody: null }) },
  userEntitlement: { uniques: [['id'], ['userId', 'entitlement']], defaults: () => ({}) },
  refundRequest: { uniques: [['id'], ['paymentId']], defaults: () => ({ status: 'PENDING', attempts: 0, errorCode: null }) },
  subscriptionEntitlement: { uniques: [['id'], ['userId']], defaults: () => ({}) },
  auditLog: { uniques: [['id']], defaults: () => ({ metadata: {} }) },
  outboxEvent: { uniques: [['id']], defaults: () => ({ publishedAt: null, attempts: 0 }) },
};

const OPS = new Set(['in', 'not', 'lt', 'lte', 'gt', 'gte', 'notIn']);

function cmp(a: any, b: any) {
  const av = a instanceof Date ? a.getTime() : typeof a === 'bigint' ? Number(a) : a;
  const bv = b instanceof Date ? b.getTime() : typeof b === 'bigint' ? Number(b) : b;
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function eq(a: any, b: any) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return cmp(a, b) === 0;
}

function flattenWhere(where: Row = {}): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(where)) {
    if (k.includes('_') && v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !Object.keys(v).some(x => OPS.has(x))) Object.assign(out, v);
    else out[k] = v;
  }
  return out;
}

function matches(row: Row, where: Row = {}): boolean {
  const w = flattenWhere(where);
  return Object.entries(w).every(([k, cond]) => {
    if (cond === undefined) return true;
    if (k === 'OR') return (cond as Row[]).some(c => matches(row, c));
    if (k === 'AND') return (cond as Row[]).every(c => matches(row, c));
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && typeof cond !== 'bigint' && Object.keys(cond).some(x => OPS.has(x))) {
      return Object.entries(cond).every(([op, val]: [string, any]) => {
        switch (op) {
          case 'in': return val.some((x: any) => eq(v, x));
          case 'notIn': return !val.some((x: any) => eq(v, x));
          case 'not': return !eq(v, val);
          case 'lt': return v !== null && v !== undefined && cmp(v, val) < 0;
          case 'lte': return v !== null && v !== undefined && cmp(v, val) <= 0;
          case 'gt': return v !== null && v !== undefined && cmp(v, val) > 0;
          case 'gte': return v !== null && v !== undefined && cmp(v, val) >= 0;
          default: return true;
        }
      });
    }
    return eq(v, cond);
  });
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

export class FakePrisma {
  tables: Record<string, Row[]> = Object.fromEntries(Object.keys(MODELS).map(m => [m, []]));
  private chain: Promise<unknown> = Promise.resolve();
  failOn?: (model: string, op: string, data: Row) => boolean;
  [model: string]: any;

  constructor() {
    for (const name of Object.keys(MODELS)) this[name] = this.delegate(name);
  }

  async $transaction(fn: (tx: FakePrisma) => Promise<any>) {
    const run = async () => {
      const snapshot = clone(this.tables);
      try {
        return await fn(this);
      } catch (e) {
        this.tables = snapshot;
        throw e;
      }
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  private withInclude(model: string, row: Row | undefined, include?: Row, select?: Row): any {
    if (!row) return null;
    let out: Row = clone(row);
    for (const [rel, on] of Object.entries(include ?? {})) {
      if (!on) continue;
      const r = MODELS[model].relations?.[rel];
      if (!r) continue;
      const target = this.tables[r.model].find(x => x.id === row[r.fk]);
      out[rel] = target ? clone(target) : null;
    }
    if (select) out = Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, out[k]]));
    return out;
  }

  private assertUnique(model: string, row: Row) {
    const rows = this.tables[model];
    const def = MODELS[model];
    for (const fields of def.uniques) {
      if (fields.some(f => row[f] === null || row[f] === undefined)) continue;
      if (rows.some(r => r !== row && fields.every(f => eq(r[f], row[f])))) throw Object.assign(new Error(`Unique constraint failed on ${model}(${fields})`), { code: 'P2002' });
    }
    if (def.check && !def.check(rows, row)) throw Object.assign(new Error(`Unique constraint failed on ${model} partial index`), { code: 'P2002' });
  }

  private applyData(target: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) target[k] = (target[k] ?? 0) + (v as any).increment;
      else if (v !== undefined) target[k] = v;
    }
    target.updatedAt = now();
  }

  private sort(rows: Row[], orderBy?: Row | Row[]) {
    const orders = !orderBy ? [] : Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
      for (const o of orders) {
        const [k, dir] = Object.entries(o)[0] as [string, string];
        const c = cmp(a[k], b[k]);
        if (c) return dir === 'desc' ? -c : c;
      }
      return 0;
    });
  }

  private delegate(model: string) {
    const self = this;
    const t = () => self.tables[model];
    const check = (op: string, data: Row) => {
      if (self.failOn?.(model, op, data)) throw Object.assign(new Error(`Injected failure ${model}.${op}`), { code: 'INJECTED' });
    };
    return {
      async findUnique(args: Row) { return self.withInclude(model, t().find(r => matches(r, args.where)), args.include, args.select); },
      async findFirst(args: Row = {}) { return self.withInclude(model, self.sort(t().filter(r => matches(r, args.where)), args.orderBy)[0], args.include, args.select); },
      async findMany(args: Row = {}) {
        let rows = self.sort(t().filter(r => matches(r, args.where)), args.orderBy);
        if (args.take) rows = rows.slice(0, args.take);
        return rows.map(r => self.withInclude(model, r, args.include, args.select));
      },
      async count(args: Row = {}) { return t().filter(r => matches(r, args.where)).length; },
      async create(args: Row) {
        check('create', args.data);
        const row: Row = { id: randomUUID(), createdAt: now(), updatedAt: now(), ...MODELS[model].defaults() };
        self.applyData(row, args.data);
        self.assertUnique(model, row);
        t().push(row);
        return self.withInclude(model, row, args.include);
      },
      async update(args: Row) {
        check('update', args.data);
        const row = t().find(r => matches(r, args.where));
        if (!row) throw Object.assign(new Error(`${model} not found`), { code: 'P2025' });
        const before = clone(row);
        self.applyData(row, args.data);
        try { self.assertUnique(model, row); } catch (e) { Object.assign(row, before); throw e; }
        return self.withInclude(model, row, args.include);
      },
      async updateMany(args: Row) {
        check('updateMany', args.data);
        const rows = t().filter(r => matches(r, args.where));
        for (const row of rows) {
          const before = clone(row);
          self.applyData(row, args.data);
          try { self.assertUnique(model, row); } catch (e) { Object.assign(row, before); throw e; }
        }
        return { count: rows.length };
      },
      async upsert(args: Row) {
        const row = t().find(r => matches(r, args.where));
        if (row) { self.applyData(row, args.update); return clone(row); }
        return this.create({ data: args.create });
      },
      async deleteMany(args: Row = {}) {
        const before = t().length;
        self.tables[model] = t().filter(r => !matches(r, args.where));
        return { count: before - self.tables[model].length };
      },
    };
  }
}
