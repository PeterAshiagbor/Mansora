import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { can, DomainError, effectiveStanding, fail, RESTRICTED_COMMANDS, restrictionMessage, SYNC_TABLES, zCalendarDate, type ServiceStanding, type Permission, type Role, type SyncTable } from '@mansora/domain';
import type { Db } from './db';
import { verifyPassword } from './passwords';

export interface UserRow {
  id: string;
  username: string;
  name: string;
  role: Role;
  status: string;
  permissions: string[];
}

export interface EngineOptions {
  db: Db;
  /** Directory for backups and other local files. */
  dataDir: string;
  appVersion?: string;
  now?: () => Date;
  fetch?: typeof fetch;
  /** Test hook: called inside the transaction of a mutating command just before commit. */
  beforeCommit?: (command: string) => void;
}

export interface CommandDef<I = any> {
  /** Permission needed, 'auth' for any signed-in user, 'public' for none. */
  perm: Permission | 'auth' | 'public';
  input: z.ZodType<I>;
  /** Mutating commands run inside one atomic transaction and are audited + queued for sync. */
  mutates?: boolean;
  /** Async commands manage their own transactions through ctx.tx(). */
  async?: boolean;
  run: (ctx: Ctx, input: I) => any;
}

export type Commands = Record<string, CommandDef>;
/** Declares commands with each handler's input typed from its own schema. */
export function defineCommands<T extends Record<string, z.ZodType>>(c: {
  [K in keyof T]: { perm: CommandDef['perm']; input: T[K]; mutates?: boolean; async?: boolean; run: (ctx: Ctx, input: z.infer<T[K]>) => any };
}): Commands {
  return c as Commands;
}

interface Session {
  userId: string;
  lastActive: number;
}

export class Ctx {
  private touched = new Map<SyncTable, Set<string>>();
  constructor(
    public readonly engine: Engine,
    public readonly command: string,
    public readonly actor: UserRow | null,
  ) {}

  get db(): Db {
    return this.engine.db;
  }
  /** The signed-in user. Only use in commands whose perm is not 'public'. */
  get user(): UserRow {
    if (!this.actor) fail('NOT_SIGNED_IN', 'Please sign in');
    return this.actor;
  }
  now(): string {
    return this.engine.now().toISOString();
  }
  id(): string {
    return randomUUID();
  }
  can(p: Permission): boolean {
    return can(this.actor, p);
  }
  require(p: Permission): void {
    if (!this.can(p)) fail('PERMISSION_DENIED', 'You do not have permission to do this', { permission: p });
  }
  get<T = any>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  all<T = any>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: unknown[]) {
    return this.db.prepare(sql).run(...params);
  }
  track(table: string, key: string): void {
    if (!(table in SYNC_TABLES)) return;
    const set = this.touched.get(table as SyncTable) ?? new Set();
    set.add(key);
    this.touched.set(table as SyncTable, set);
  }
  insert(table: string, row: Record<string, unknown>): void {
    const cols = Object.keys(row);
    this.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...Object.values(row));
    const spec = (SYNC_TABLES as Record<string, { key: string }>)[table];
    if (spec) this.track(table, String(row[spec.key]));
  }
  update(table: string, key: string, patch: Record<string, unknown>): void {
    const spec = (SYNC_TABLES as Record<string, { key: string }>)[table];
    const pk = spec?.key ?? 'id';
    const cols = Object.keys(patch);
    const res = this.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${pk} = ?`, ...Object.values(patch), key);
    if (res.changes !== 1) fail('NOT_FOUND', 'Record not found');
    this.track(table, key);
  }
  audit(entityType: string | null, entityId: string | null, detail: Record<string, unknown> = {}, action = this.command): void {
    this.insert('audit_logs', {
      id: this.id(),
      actor_id: this.actor?.id ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      detail: JSON.stringify(detail),
      occurred_at: this.now(),
    });
  }
  setting(key: string): string | undefined {
    return this.engine.meta(key);
  }
  /**
   * Resolve who authorises a restricted action: the signed-in user if they hold
   * the permission, otherwise a supervisor whose credentials are entered on the spot.
   */
  authorise(permission: Permission, approver?: { username: string; password: string } | null): string {
    if (this.can(permission)) return this.user.id;
    if (!approver) fail('APPROVAL_REQUIRED', 'A manager or owner must approve this action', { permission });
    const sup = this.engine.verifyCredentials(approver.username, approver.password);
    if (!can(sup, permission)) fail('PERMISSION_DENIED', 'That person is not allowed to approve this action', { permission });
    return sup.id;
  }
  tx<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
  /** Write one outbox event containing every synced row this command touched. */
  flush(): void {
    if (this.touched.size === 0) return;
    const rows: Record<string, unknown[]> = {};
    for (const [table, keys] of this.touched) {
      const spec = SYNC_TABLES[table];
      const cols = Object.keys(spec.cols).join(', ');
      const stmt = this.db.prepare(`SELECT ${cols} FROM ${table} WHERE ${spec.key} = ?`);
      rows[table] = [...keys].map((k) => stmt.get(k)).filter(Boolean);
    }
    this.touched.clear();
    this.run(
      'INSERT INTO outbox (id, type, payload, actor_id, occurred_at) VALUES (?, ?, ?, ?, ?)',
      this.id(), this.command, JSON.stringify({ rows }), this.actor?.id ?? null, this.now(),
    );
  }
}

export class Engine {
  readonly db: Db;
  readonly dataDir: string;
  readonly appVersion: string;
  readonly now: () => Date;
  readonly fetch: typeof fetch;
  private sessions = new Map<string, Session>();
  // Approval failures must survive a rejected financial transaction. Contains no credentials.
  private credentialFailures?: Map<string, { attempts: number; lockedUntil: string | null }>;

  private commands: Commands = {};
  private beforeCommit?: (command: string) => void;
  /** Result of the most recent sync attempt (in memory only). */
  syncState: { running: boolean; online: boolean | null; lastError: string | null; lastAttemptAt: string | null } = {
    running: false, online: null, lastError: null, lastAttemptAt: null,
  };

  constructor(opts: EngineOptions) {
    this.db = opts.db;
    this.dataDir = opts.dataDir;
    this.appVersion = opts.appVersion ?? '0.1.0';
    this.now = opts.now ?? (() => new Date());
    this.fetch = opts.fetch ?? ((...a) => globalThis.fetch(...a));
    this.beforeCommit = opts.beforeCommit;
  }

  register(commands: Commands): this {
    Object.assign(this.commands, commands);
    return this;
  }
  commandNames(): string[] {
    return Object.keys(this.commands);
  }

  meta(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  }
  setMeta(key: string, value: string | null): void {
    if (value === null) this.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }
  get activated(): boolean {
    return !!this.meta('device_token');
  }
  lockAfterMs(): number {
    return Number(this.meta('lock_minutes') ?? 10) * 60_000;
  }

  loadUser(id: string): UserRow | undefined {
    const r = this.db.prepare('SELECT id, username, name, role, status, permissions FROM users WHERE id = ?').get(id) as any;
    return r ? { ...r, permissions: JSON.parse(r.permissions) } : undefined;
  }

  /** Verify a username/password against the local store. Throttles repeated failures. */
  verifyCredentials(username: string, password: string): UserRow {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as any;
    const nowMs = this.now().getTime();
    if (row?.locked_until && Date.parse(row.locked_until) > nowMs) fail('ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a minute.');
    if (!row || !verifyPassword(password, row.password_hash)) {
      if (row) {
        const attempts = row.failed_attempts + 1;
        const lock = attempts >= 5 ? new Date(nowMs + 60_000).toISOString() : null;
        this.db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : attempts, lock, row.id);
        this.credentialFailures?.set(row.id, { attempts: lock ? 0 : attempts, lockedUntil: lock });
      }
      fail('INVALID_CREDENTIALS', 'Incorrect username or password');
    }
    if (row.status !== 'active') fail('ACCOUNT_DISABLED', 'This account has been disabled');
    if (row.failed_attempts) this.db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(row.id);
    return this.loadUser(row.id)!;
  }

  createSession(userId: string): string {
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { userId, lastActive: this.now().getTime() });
    return token;
  }
  endSession(token: string | null): void {
    if (token) this.sessions.delete(token);
  }
  endSessionsFor(userId: string): void {
    for (const [t, s] of this.sessions) if (s.userId === userId) this.sessions.delete(t);
  }

  private resolve(token: string | null): UserRow | null {
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    const nowMs = this.now().getTime();
    if (nowMs - s.lastActive > this.lockAfterMs()) {
      this.sessions.delete(token);
      fail('SESSION_LOCKED', 'Locked after inactivity. Please sign in again.');
    }
    const user = this.loadUser(s.userId);
    if (!user || user.status !== 'active') {
      this.sessions.delete(token);
      return null;
    }
    s.lastActive = nowMs;
    return user;
  }

  /**
   * The single entry point for every operation. Authentication, permission
   * checks and input validation happen here - never in the user interface.
   */
  async execute<T = any>(token: string | null, name: string, input: unknown = {}): Promise<T> {
    const def = this.commands[name];
    if (!def) fail('UNKNOWN_COMMAND', `Unknown command "${name}"`);
    const actor = this.resolve(token);
    if (def.perm !== 'public') {
      if (!actor) fail('NOT_SIGNED_IN', 'Please sign in');
      if (def.perm !== 'auth' && !can(actor, def.perm)) {
        this.recordDenied(actor, name, def.perm);
        fail('PERMISSION_DENIED', 'You do not have permission to do this', { permission: def.perm });
      }
    }
    if ((RESTRICTED_COMMANDS as readonly string[]).includes(name)) {
      // Non-payment policy (D-28): checked here, at the only entry point, so no screen can bypass it.
      const standing = this.standing();
      if (standing?.stage === 'restricted') {
        if (actor) this.recordDenied(actor, name, 'service.restricted', 'service.restricted');
        fail('SERVICE_RESTRICTED', restrictionMessage(standing), { invoiceNumber: standing.invoiceNumber, restrictFrom: standing.restrictFrom });
      }
    }
    const parsed = def.input.safeParse(input ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      fail('INVALID_INPUT', `${first.path.join('.') || 'input'}: ${first.message}`, parsed.error.issues);
    }
    const ctx = new Ctx(this, name, actor);
    try {
      if (def.async) return await def.run(ctx, parsed.data);
      if (!def.mutates) return def.run(ctx, parsed.data);
      const previousFailures = this.credentialFailures;
      const failures = new Map<string, { attempts: number; lockedUntil: string | null }>();
      this.credentialFailures = failures;
      try {
        return this.db.transaction(() => {
          const result = def.run(ctx, parsed.data);
          ctx.flush();
          this.beforeCommit?.(name);
          return result;
        }).immediate();
      } catch (error) {
        // SQLite has rolled the command back. Keep only authentication throttling;
        // sale, stock, audit and outbox writes remain rolled back together.
        if (failures.size) this.db.transaction(() => {
          const update = this.db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?');
          for (const [id, failure] of failures) update.run(failure.attempts, failure.lockedUntil, id);
        }).immediate();
        throw error;
      } finally {
        this.credentialFailures = previousFailures;
      }
    } catch (e: any) {
      if (e instanceof DomainError) throw e;
      if (typeof e?.code === 'string' && e.code.startsWith('SQLITE_CONSTRAINT')) fail('CONFLICT', friendlyConstraint(e.message));
      throw e;
    }
  }

  /** Today's non-payment standing from what the server last sent; dates keep moving while offline. */
  standing(): ServiceStanding | null {
    let stored: unknown = null;
    try { stored = JSON.parse(this.meta('service_standing') ?? 'null'); } catch { stored = null; }
    return effectiveStanding(stored, this.now().toISOString().slice(0, 10));
  }

  private recordDenied(actor: UserRow, command: string, permission: string, action = 'permission.denied'): void {
    const ctx = new Ctx(this, command, actor);
    ctx.tx(() => {
      ctx.audit('command', command, { permission }, action);
      ctx.flush();
    });
  }
}

function friendlyConstraint(message: string): string {
  if (message.includes('products.barcode') || message.includes('products_barcode')) return 'Another product already uses this barcode';
  if (message.includes('products.sku') || message.includes('products_sku')) return 'Another product already uses this SKU';
  if (message.includes('users.username')) return 'That username is already taken';
  if (message.includes('categories.name')) return 'A category with this name already exists';
  if (message.includes('shifts_one_open')) return 'This cashier already has an open shift';
  if (message.includes('immutable') || message.includes('cannot be deleted')) return 'Completed financial records cannot be changed';
  return 'This change conflicts with an existing record';
}

export const zId = z.string().uuid();
export const zMoney = z.number().int().nonnegative().max(1_000_000_000_00);
export const zQty = z.number().int().positive().max(10_000_000);
export const zText = (max = 200) => z.string().trim().min(1).max(max);
export const zOptText = (max = 200) => z.string().trim().max(max).nullish().transform((v) => v || null);
export const zApprover = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) }).nullish();
export const zRange = z.object({ from: zCalendarDate, to: zCalendarDate });
export const empty = z.object({}).passthrough();

/** Inclusive day range -> [startIso, endIsoExclusive). Ghana is UTC+0 all year, so UTC days are local days. */
export function dayBounds(r: { from: string; to: string }): [string, string] {
  // A reversed range used to return an empty report that looked like a quiet day (C30 F02).
  if (r.from > r.to) fail('INVALID_INPUT', 'The start date must be on or before the end date');
  const end = new Date(`${r.to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return [`${r.from}T00:00:00.000Z`, end.toISOString()];
}
