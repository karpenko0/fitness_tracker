/**
 * Stateful in-memory Prisma-мок для E2E-сценариев SPEC-009.
 * Поддерживает ровно те запросы, которые выполняет habit-модуль:
 * where (равенство, equals/insensitive, in, not, lt, композитные unique-ключи,
 * вложенные habit/user), orderBy (объект/массив), skip/take, select,
 * include (habit, habit.user), data c {increment}, $transaction (callback и массив).
 */

type Row = Record<string, any>;

const eq = (a: unknown, b: unknown): boolean => {
  if (a instanceof Date || b instanceof Date) {
    return a != null && b != null && new Date(a as any).getTime() === new Date(b as any).getTime();
  }
  return a === b;
};

const DEFAULTS: Record<string, () => Row> = {
  habit: () => ({
    goalValue: null,
    unit: null,
    weekdays: [],
    oneTimeDate: null,
    reminderTime: null,
    telegramChatId: null,
    status: 'ACTIVE',
    habitStart: null,
    pausedAt: null,
    archivedAt: null,
    currentStreak: 0,
    bestStreak: 0,
    version: 1,
  }),
  habitTask: () => ({
    status: 'PENDING',
    progressValue: null,
    completedAt: null,
    skippedAt: null,
    expiredAt: null,
    version: 1,
  }),
  habitNotification: () => ({ status: 'SCHEDULED', attempts: 0, lastError: null, sentAt: null }),
  habitTaskEvent: () => ({}),
  idempotencyKey: () => ({ responseStatus: 200 }),
  user: () => ({ notificationsDisabled: false }),
};

export interface MemoryPrisma {
  prisma: any;
  store: Record<string, Row[]>;
}

export function createMemoryPrisma(): MemoryPrisma {
  const store: Record<string, Row[]> = {
    user: [],
    habit: [],
    habitTask: [],
    habitTaskEvent: [],
    habitNotification: [],
    idempotencyKey: [],
  };
  const counters: Record<string, number> = {};
  let txQueue: Promise<unknown> = Promise.resolve();

  const relationOf = (row: Row, relation: string): Row | undefined => {
    if (relation === 'habit') return store.habit.find((h) => h.id === row.habitId);
    if (relation === 'user') return store.user.find((u) => u.id === row.userId);
    return undefined;
  };

  const matchesCondition = (value: unknown, cond: unknown): boolean => {
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ('equals' in c) {
        if (c.mode === 'insensitive') return String(value).toLowerCase() === String(c.equals).toLowerCase();
        return eq(value, c.equals);
      }
      if ('in' in c) return (c.in as unknown[]).some((v) => eq(value, v));
      if ('not' in c) return !eq(value, c.not);
      if ('lt' in c) return Number(value) < Number(c.lt);
      if ('gt' in c) return Number(value) > Number(c.gt);
    }
    return eq(value, cond);
  };

  const matches = (row: Row, where: Row = {}): boolean => {
    for (const [key, cond] of Object.entries(where ?? {})) {
      if (key === 'habitId_localDate') {
        const { habitId, localDate } = cond as Row;
        if (!eq(row.habitId, habitId) || !eq(row.localDate, localDate)) return false;
        continue;
      }
      if (key === 'habitId_taskLocalDate_kind') {
        const { habitId, taskLocalDate, kind } = cond as Row;
        if (!eq(row.habitId, habitId) || !eq(row.taskLocalDate, taskLocalDate) || row.kind !== kind) return false;
        continue;
      }
      if (key === 'userId_key') {
        const { userId, key: k } = cond as Row;
        if (row.userId !== userId || row.key !== k) return false;
        continue;
      }
      if (key === 'habit' || key === 'user') {
        const rel = relationOf(row, key);
        if (!rel || !matches(rel, cond as Row)) return false;
        continue;
      }
      if (!matchesCondition(row[key], cond)) return false;
    }
    return true;
  };

  const find = (model: string, where: Row = {}): Row[] => store[model].filter((row) => matches(row, where));

  const sortRows = (rows: Row[], orderBy: unknown): Row[] => {
    if (!orderBy) return rows;
    const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
      for (const clause of clauses) {
        for (const [field, dir] of Object.entries(clause as Row)) {
          const av = a[field];
          const bv = b[field];
          if (av === bv) continue;
          const cmp = av < bv ? -1 : 1;
          return dir === 'desc' ? -cmp : cmp;
        }
      }
      return 0;
    });
  };

  const shape = (model: string, row: Row, args: { select?: Row; include?: Row } = {}): Row => {
    let out: Row = { ...row };
    if (args.include) {
      for (const [rel, relArgs] of Object.entries(args.include)) {
        const related = relationOf(row, rel);
        out[rel] = related ? shape(rel === 'habit' ? 'habit' : 'user', related, (relArgs ?? {}) as Row) : null;
      }
    }
    if (args.select) {
      const picked: Row = {};
      for (const [field, on] of Object.entries(args.select)) {
        if (on) picked[field] = out[field];
      }
      out = picked;
    }
    return out;
  };

  const applyData = (row: Row, data: Row = {}): Row => {
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && typeof value === 'object' && 'increment' in (value as Row)) {
        row[key] = (Number(row[key]) || 0) + Number((value as Row).increment);
      } else {
        row[key] = value;
      }
    }
    row.updatedAt = new Date();
    return row;
  };

  const insert = (model: string, data: Row): Row => {
    counters[model] = (counters[model] ?? 0) + 1;
    const row: Row = {
      ...DEFAULTS[model](),
      ...data,
      id: data.id ?? `${model}-${counters[model]}`,
      createdAt: data.createdAt ?? new Date(),
      updatedAt: data.updatedAt ?? new Date(),
    };
    store[model].push(row);
    return row;
  };

  const delegate = (model: string) => ({
    async count({ where }: { where?: Row } = {}) {
      return find(model, where).length;
    },
    async create({ data }: { data: Row }) {
      return shape(model, insert(model, data));
    },
    async findFirst(args: { where?: Row; orderBy?: unknown; include?: Row; select?: Row } = {}) {
      const rows = sortRows(find(model, args.where), args.orderBy);
      return rows.length ? shape(model, rows[0], args) : null;
    },
    async findMany(args: { where?: Row; orderBy?: unknown; skip?: number; take?: number; include?: Row; select?: Row } = {}) {
      let rows = sortRows(find(model, args.where), args.orderBy);
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take != null) rows = rows.slice(0, args.take);
      return rows.map((row) => shape(model, row, args));
    },
    async findUnique(args: { where: Row; include?: Row; select?: Row }) {
      const row = find(model, args.where)[0];
      return row ? shape(model, row, args) : null;
    },
    async update(args: { where: Row; data: Row }) {
      const row = find(model, args.where)[0];
      if (!row) throw Object.assign(new Error(`Record to update not found (${model})`), { code: 'P2025' });
      applyData(row, args.data);
      return shape(model, row);
    },
    async updateMany(args: { where: Row; data: Row }) {
      const rows = find(model, args.where);
      for (const row of rows) applyData(row, args.data);
      return { count: rows.length };
    },
    async upsert(args: { where: Row; create: Row; update: Row }) {
      const existing = find(model, args.where)[0];
      if (existing) {
        if (args.update && Object.keys(args.update).length) applyData(existing, args.update);
        return shape(model, existing);
      }
      return shape(model, insert(model, args.create));
    },
    async delete(args: { where: Row }) {
      const row = find(model, args.where)[0];
      if (!row) throw Object.assign(new Error('Record to delete does not exist.'), { code: 'P2025' });
      store[model] = store[model].filter((r) => r !== row);
      return shape(model, row);
    },
  });

  const prisma: any = {
    user: delegate('user'),
    habit: delegate('habit'),
    habitTask: delegate('habitTask'),
    habitTaskEvent: delegate('habitTaskEvent'),
    habitNotification: delegate('habitNotification'),
    idempotencyKey: delegate('idempotencyKey'),
    async $transaction(arg: unknown) {
      if (typeof arg !== 'function') return Promise.all(arg as Promise<unknown>[]);
      // Транзакции выполняются строго последовательно (эмуляция изоляции БД):
      // без очереди два параллельных запроса прочитали бы одну и ту же version.
      const run = () => (arg as (tx: any) => Promise<unknown>)(prisma);
      const result = txQueue.then(run, run);
      txQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };

  return { prisma, store };
}
