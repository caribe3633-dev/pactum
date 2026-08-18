/**
 * ══════════════════════════════════════════════════════════════════════
 * PACTUM · AUTHORIZATION — ROLE + SCOPE + MODULE + ACTION + TIME
 * ══════════════════════════════════════════════════════════════════════
 *
 * A permission was a boolean: `canEdit` on a project. That answered
 * "may this person type here" and nothing else. It could not express
 *
 *     Ahmed may EDIT and SUBMIT the Budget on Project A,
 *     but never APPROVE it,
 *     and only between 1 January and 30 June.
 *
 * which is the sentence this module exists to hold.
 *
 * FIVE AXES, ALL REQUIRED
 * -----------------------
 *   ROLE     admin | sector-manager | project-manager | engineer
 *   SCOPE    global | sector:<id> | project:<id>
 *   MODULE   budget | cashflow | changes | claims | baseline | evm
 *            documents | reports
 *   ACTION   view | create | edit | submit | review | approve
 *            archive | restore
 *   TIME     effectiveFrom .. effectiveTo
 *
 * HOLDING A MODULE IS NOT HOLDING ITS ACTIONS. A grant names its actions
 * explicitly, so `edit` never implies `approve` and `submit` never
 * implies `review`. That separation is the whole point of a financial
 * approval chain: the person who prepares a figure must not be the
 * person who authorises it.
 *
 * TIME IS PART OF THE PERMISSION, NOT METADATA. `can()` takes the date
 * it is asking about and defaults to now. Asking "could Ahmed approve
 * this on 3 March?" is a different question from "can he today", and
 * both must be answerable — see rule 17: historical activity is never
 * reinterpreted through someone's current role.
 *
 * PURE. This module reads and writes `pactum-permissions` and nothing
 * else. It computes no money, touches no EVM, no baseline, no budget.
 * ══════════════════════════════════════════════════════════════════════
 */

export type Role = 'admin' | 'sector-manager' | 'project-manager' | 'engineer';

export const ROLES: { value: Role; en: string; ar: string }[] = [
  { value: 'admin',           en: 'Admin',           ar: 'مدير النظام' },
  { value: 'sector-manager',  en: 'Sector Manager',  ar: 'مدير قطاع' },
  { value: 'project-manager', en: 'Project Manager', ar: 'مدير مشروع' },
  { value: 'engineer',        en: 'Engineer',        ar: 'مهندس' },
];

export type ModuleKey =
  | 'budget' | 'cashflow' | 'changes' | 'claims'
  | 'baseline' | 'evm' | 'documents' | 'reports';

export const MODULES: { value: ModuleKey; en: string; ar: string }[] = [
  { value: 'budget',    en: 'Budget',         ar: 'الميزانية' },
  { value: 'cashflow',  en: 'Cash Flow',      ar: 'التدفق النقدي' },
  { value: 'changes',   en: 'Change Orders',  ar: 'أوامر التغيير' },
  { value: 'claims',    en: 'Claims',         ar: 'المطالبات' },
  { value: 'baseline',  en: 'Baseline',       ar: 'خطة الأساس' },
  { value: 'evm',       en: 'EVM',            ar: 'القيمة المكتسبة' },
  { value: 'documents', en: 'Documents',      ar: 'المستندات' },
  { value: 'reports',   en: 'Reports',        ar: 'التقارير' },
];

export type Action =
  | 'view' | 'create' | 'edit' | 'submit'
  | 'review' | 'approve' | 'archive' | 'restore';

export const ACTIONS: { value: Action; en: string; ar: string }[] = [
  { value: 'view',    en: 'View',    ar: 'عرض' },
  { value: 'create',  en: 'Create',  ar: 'إنشاء' },
  { value: 'edit',    en: 'Edit',    ar: 'تعديل' },
  { value: 'submit',  en: 'Submit',  ar: 'تقديم' },
  { value: 'review',  en: 'Review',  ar: 'مراجعة' },
  { value: 'approve', en: 'Approve', ar: 'اعتماد' },
  { value: 'archive', en: 'Archive', ar: 'أرشفة' },
  { value: 'restore', en: 'Restore', ar: 'استعادة' },
];

export type ScopeType = 'global' | 'sector' | 'project';

export interface Scope {
  type: ScopeType;
  /** '' for global. A sector id or a project id otherwise. */
  id: string;
}

/**
 * One permission grant.
 *
 * IMMUTABLE ONCE SUPERSEDED. A transfer does not edit a grant: it closes
 * the old one by setting `effectiveTo` and `supersededBy`, then writes a
 * new one. The record of who held what, and when, therefore survives
 * every reassignment — see `transferGrant`.
 */
export interface Grant {
  id: string;
  userId: string;
  role: Role;
  scopeType: ScopeType;
  /** '' when scopeType is 'global'. */
  scopeId: string;
  module: ModuleKey;
  /** Explicit. Holding the module grants nothing on its own. */
  actions: Action[];
  /** ISO yyyy-mm-dd. */
  effectiveFrom: string;
  /** ISO yyyy-mm-dd. '' means open-ended. */
  effectiveTo: string;
  grantedBy: string;
  grantedAt: string;
  reason: string;
  /** Set when a transfer or revocation closed this grant. */
  supersededBy?: string;
  supersededAt?: string;
}

const KEY = 'pactum-permissions';

// ── Storage ────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function cleanGrant(v: any): Grant | null {
  const id = str(v?.id).trim();
  const userId = str(v?.userId).trim();
  if (!id || !userId) return null;
  const role = ROLES.some(r => r.value === v?.role) ? v.role as Role : 'engineer';
  const scopeType = (['global', 'sector', 'project'] as const)
    .includes(v?.scopeType) ? v.scopeType as ScopeType : 'project';
  const module = MODULES.some(m => m.value === v?.module) ? v.module as ModuleKey : 'reports';
  const actions: Action[] = Array.isArray(v?.actions)
    ? v.actions.filter((a: any) => ACTIONS.some(x => x.value === a))
    : [];
  return {
    id, userId, role, scopeType,
    scopeId: str(v?.scopeId),
    module, actions,
    effectiveFrom: str(v?.effectiveFrom),
    effectiveTo: str(v?.effectiveTo),
    grantedBy: str(v?.grantedBy) || 'unknown',
    grantedAt: str(v?.grantedAt),
    reason: str(v?.reason),
    supersededBy: v?.supersededBy ? str(v.supersededBy) : undefined,
    supersededAt: v?.supersededAt ? str(v.supersededAt) : undefined,
  };
}

export function readGrants(): Grant[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(cleanGrant).filter((g): g is Grant => g !== null);
  } catch {
    return [];
  }
}

export function writeGrants(list: Grant[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* quota — the caller cannot fix it either */ }
}

// ── Time ───────────────────────────────────────────────────────────────

/** yyyy-mm-dd for a Date. */
export function iso10(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Is this grant in force on `at`?
 *
 * An empty `effectiveFrom` means "always has been"; an empty
 * `effectiveTo` means "still is". A superseded grant is NOT
 * automatically dead — it stays valid up to its `effectiveTo`, which is
 * what makes a mid-year transfer read correctly: Ahmed's authority on
 * 3 March is still true after Mohamed takes over in July.
 */
export function isActiveOn(g: Grant, at: string): boolean {
  if (g.effectiveFrom && at < g.effectiveFrom) return false;
  if (g.effectiveTo && at > g.effectiveTo) return false;
  return true;
}

// ── The single authorization question ──────────────────────────────────

export interface AuthContext {
  /** Which project the action targets, when it targets one. */
  projectId?: string;
  /** The sector that project belongs to, so sector scope can match. */
  sectorId?: string;
}

/**
 * Does `userId` hold `action` on `module`, for this scope, on this date?
 *
 * THE ONLY AUTHORIZATION FUNCTION IN PACTUM. Every guard defers to it;
 * nothing re-implements the rules.
 *
 * A global grant covers every scope. A sector grant covers that sector
 * and the projects inside it. A project grant covers only that project.
 * Narrower never widens: a project-scoped grant can never satisfy a
 * sector-scoped question.
 */
export function can(
  userId: string,
  module: ModuleKey,
  action: Action,
  ctx: AuthContext = {},
  at: string = iso10(),
  grants?: Grant[],
): boolean {
  const list = grants ?? readGrants();
  return list.some(g => {
    if (g.userId !== userId) return false;
    if (g.module !== module) return false;
    if (!g.actions.includes(action)) return false;
    if (!isActiveOn(g, at)) return false;
    return scopeCovers(g, ctx);
  });
}

/** Does this grant's scope reach the thing being acted on? */
export function scopeCovers(g: Grant, ctx: AuthContext): boolean {
  if (g.scopeType === 'global') return true;
  if (g.scopeType === 'sector') return !!ctx.sectorId && g.scopeId === ctx.sectorId;
  if (g.scopeType === 'project') return !!ctx.projectId && g.scopeId === ctx.projectId;
  return false;
}

/** Every grant in force for a user on a date. */
export function grantsFor(userId: string, at: string = iso10(), grants?: Grant[]): Grant[] {
  return (grants ?? readGrants()).filter(g => g.userId === userId && isActiveOn(g, at));
}

/**
 * The role a user held on a given date.
 *
 * RULE 17 — historical activity is never reinterpreted. An audit entry
 * records the role at the time, and this is how that role is recovered
 * rather than reading whatever the user happens to be today.
 * Returns '' when the user held nothing then.
 */
export function roleOn(userId: string, at: string, grants?: Grant[]): Role | '' {
  const active = grantsFor(userId, at, grants);
  if (active.length === 0) return '';
  // Highest authority wins when several are held at once.
  const order: Role[] = ['admin', 'sector-manager', 'project-manager', 'engineer'];
  for (const r of order) if (active.some(g => g.role === r)) return r;
  return '';
}

// ── Who may grant what (rules 14, 15) ──────────────────────────────────

export type GrantRefusal =
  | 'not-authorised'
  | 'outside-scope'
  | 'cannot-grant-admin'
  | 'cannot-grant-sector-manager'
  | 'self-elevation'
  | 'invalid';

/**
 * May `actor` create this grant?
 *
 * ════════════════════════════════════════════════════════════════════
 * THE ESCALATION RULES, IN ONE PLACE.
 *
 *   Admin           anything.
 *   Sector Manager  inside their own sector only. May not mint an Admin
 *                   or another Sector Manager.
 *   Project Manager inside their own projects only. May not mint an
 *                   Admin or a Sector Manager.
 *   Engineer        may grant nothing.
 *
 * SELF-ELEVATION IS REFUSED OUTRIGHT. Without that check, a project
 * manager could grant themselves a wider grant and then use it — the
 * classic privilege-escalation hole. Granting to yourself is refused
 * unless you are an admin, who already holds everything anyway.
 * ════════════════════════════════════════════════════════════════════
 */
export function canGrant(
  actorId: string,
  proposed: Pick<Grant, 'userId' | 'role' | 'scopeType' | 'scopeId'>,
  ctx: AuthContext = {},
  at: string = iso10(),
  grants?: Grant[],
): { ok: true } | { ok: false; reason: GrantRefusal } {
  const list = grants ?? readGrants();
  const actorRole = roleOn(actorId, at, list);

  if (actorRole === 'admin') return { ok: true };
  if (actorRole === '' || actorRole === 'engineer') {
    return { ok: false, reason: 'not-authorised' };
  }

  // Nobody below admin may mint an admin, ever.
  if (proposed.role === 'admin') return { ok: false, reason: 'cannot-grant-admin' };
  // Nor a sector manager: that is a peer or a superior.
  if (proposed.role === 'sector-manager') {
    return { ok: false, reason: 'cannot-grant-sector-manager' };
  }
  // Nor a global scope, whatever the role attached to it.
  if (proposed.scopeType === 'global') return { ok: false, reason: 'outside-scope' };

  if (proposed.userId === actorId) return { ok: false, reason: 'self-elevation' };

  const mine = list.filter(g => g.userId === actorId && isActiveOn(g, at));

  if (actorRole === 'sector-manager') {
    const sectors = new Set(
      mine.filter(g => g.scopeType === 'sector').map(g => g.scopeId));
    if (proposed.scopeType === 'sector') {
      return sectors.has(proposed.scopeId) ? { ok: true } : { ok: false, reason: 'outside-scope' };
    }
    // A project inside one of my sectors. The caller supplies the link.
    if (proposed.scopeType === 'project') {
      return ctx.sectorId && sectors.has(ctx.sectorId)
        ? { ok: true } : { ok: false, reason: 'outside-scope' };
    }
    return { ok: false, reason: 'outside-scope' };
  }

  // project-manager
  if (proposed.scopeType !== 'project') return { ok: false, reason: 'outside-scope' };
  const projects = new Set(
    mine.filter(g => g.scopeType === 'project').map(g => g.scopeId));
  return projects.has(proposed.scopeId)
    ? { ok: true } : { ok: false, reason: 'outside-scope' };
}

// ── Mutations ──────────────────────────────────────────────────────────

export interface GrantResult {
  ok: boolean;
  reason?: GrantRefusal;
  grant?: Grant;
  /** The closed predecessor, on a transfer. */
  superseded?: Grant;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface GrantInput {
  userId: string;
  role: Role;
  scopeType: ScopeType;
  scopeId: string;
  module: ModuleKey;
  actions: Action[];
  effectiveFrom?: string;
  effectiveTo?: string;
  reason?: string;
}

/** Creates a grant, subject to the escalation rules. */
export function grant(
  actorId: string, input: GrantInput, ctx: AuthContext = {}, at: string = iso10(),
): GrantResult {
  if (!input?.userId || !input?.module || !Array.isArray(input.actions) || input.actions.length === 0) {
    return { ok: false, reason: 'invalid' };
  }
  const list = readGrants();
  const allowed = canGrant(actorId, input, ctx, at, list);
  if (!allowed.ok) return { ok: false, reason: allowed.reason };

  const g: Grant = {
    id: newId('grant'),
    userId: input.userId,
    role: input.role,
    scopeType: input.scopeType,
    scopeId: input.scopeType === 'global' ? '' : str(input.scopeId),
    module: input.module,
    actions: input.actions.slice(),
    effectiveFrom: input.effectiveFrom || at,
    effectiveTo: input.effectiveTo || '',
    grantedBy: actorId,
    grantedAt: new Date().toISOString(),
    reason: str(input.reason),
  };
  writeGrants([...list, g]);
  return { ok: true, grant: g };
}

/**
 * Moves a grant from one person to another.
 *
 * ════════════════════════════════════════════════════════════════════
 * A TRANSFER DELETES NOTHING.
 *
 * The outgoing grant is CLOSED — `effectiveTo` is set to the day before
 * the handover and `supersededBy` points at the replacement. It stays in
 * the store forever. So the question "who could approve this on 3 March"
 * still returns Ahmed after Mohamed has taken over in July, which is the
 * only way historical activity can be read honestly.
 *
 * The two grants therefore never overlap: Ahmed to 30 June, Mohamed from
 * 1 July.
 * ════════════════════════════════════════════════════════════════════
 */
export function transferGrant(
  actorId: string,
  grantId: string,
  toUserId: string,
  from: string,
  reason: string,
  ctx: AuthContext = {},
  at: string = iso10(),
): GrantResult {
  const list = readGrants();
  const i = list.findIndex(g => g.id === grantId);
  if (i < 0) return { ok: false, reason: 'invalid' };
  const src = list[i];

  const proposed = {
    userId: toUserId, role: src.role,
    scopeType: src.scopeType, scopeId: src.scopeId,
  };
  const allowed = canGrant(actorId, proposed, ctx, at, list);
  if (!allowed.ok) return { ok: false, reason: allowed.reason };

  const handover = from || at;
  const dayBefore = (() => {
    const d = new Date(handover + 'T00:00:00Z');
    if (isNaN(d.getTime())) return handover;
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const next: Grant = {
    id: newId('grant'),
    userId: toUserId,
    role: src.role,
    scopeType: src.scopeType,
    scopeId: src.scopeId,
    module: src.module,
    actions: src.actions.slice(),
    effectiveFrom: handover,
    effectiveTo: '',
    grantedBy: actorId,
    grantedAt: new Date().toISOString(),
    reason: str(reason),
  };

  const closed: Grant = {
    ...src,
    effectiveTo: src.effectiveTo || dayBefore,
    supersededBy: next.id,
    supersededAt: new Date().toISOString(),
  };

  const out = list.slice();
  out[i] = closed;
  out.push(next);
  writeGrants(out);
  return { ok: true, grant: next, superseded: closed };
}

/**
 * Ends a grant. The record is KEPT and closed, never removed — a
 * revoked permission is a fact about the past, not an absence.
 */
export function revokeGrant(
  actorId: string, grantId: string, reason: string,
  ctx: AuthContext = {}, at: string = iso10(),
): GrantResult {
  const list = readGrants();
  const i = list.findIndex(g => g.id === grantId);
  if (i < 0) return { ok: false, reason: 'invalid' };
  const src = list[i];
  const allowed = canGrant(actorId, src, ctx, at, list);
  if (!allowed.ok) return { ok: false, reason: allowed.reason };

  const closed: Grant = {
    ...src,
    effectiveTo: at,
    supersededAt: new Date().toISOString(),
    reason: src.reason ? `${src.reason} · revoked: ${str(reason)}` : `revoked: ${str(reason)}`,
  };
  const out = list.slice();
  out[i] = closed;
  writeGrants(out);
  return { ok: true, grant: closed };
}

/**
 * Seeds the founding admin grant.
 *
 * Without one, `canGrant` refuses everybody and the console is a locked
 * room with the key inside. Runs once: if any admin grant exists it does
 * nothing.
 */
export function ensureRootAdmin(userId: string): void {
  const list = readGrants();
  if (list.some(g => g.role === 'admin' && g.scopeType === 'global')) return;
  const now = new Date().toISOString();
  const all: Grant[] = MODULES.map(m => ({
    id: newId('grant'),
    userId,
    role: 'admin' as Role,
    scopeType: 'global' as ScopeType,
    scopeId: '',
    module: m.value,
    actions: ACTIONS.map(a => a.value),
    effectiveFrom: iso10(),
    effectiveTo: '',
    grantedBy: 'system',
    grantedAt: now,
    reason: 'founding administrator',
  }));
  writeGrants([...list, ...all]);
}
