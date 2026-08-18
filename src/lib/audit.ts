/**
 * ══════════════════════════════════════════════════════════════════════
 * PACTUM · AUDIT TRAIL — APPEND ONLY, AND THAT IS ENFORCED
 * ══════════════════════════════════════════════════════════════════════
 *
 * WHO + WHEN + WHAT + BEFORE + AFTER + VERSION + REASON.
 *
 * THERE IS NO UPDATE FUNCTION AND NO DELETE FUNCTION IN THIS MODULE.
 * That is not an omission. An audit trail that can be edited by the
 * people it audits is decoration, so the capability simply does not
 * exist to be called — not for an engineer, not for a project manager,
 * not for an admin. `record()` is the only writer and it only ever
 * appends.
 *
 * CORRECTING THE RECORD (rule 11). A wrong entry is not fixed by
 * changing it. `correct()` writes a NEW event that points at the old one
 * through `correctsId`. Both are then visible, and the fact that
 * somebody thought a correction was needed is itself part of the
 * history.
 *
 * THE ACTOR'S ROLE IS FROZEN AT THE MOMENT (rule 17). `actorRole` is
 * copied into the event when it is written. If Ahmed is promoted next
 * year, last March's entries still say what he was in March. Reading the
 * current role to explain a past action is exactly the misreading this
 * field prevents.
 *
 * BEFORE AND AFTER ARE STRINGS. Not objects. A stored object invites a
 * later reader to re-derive meaning from it; a rendered string is what
 * was true, as it was shown, and it cannot drift when a type changes.
 * ══════════════════════════════════════════════════════════════════════
 */

import type { ModuleKey, Action, Role, ScopeType } from './authz';

export interface AuditEvent {
  id: string;
  /** Who did it. Never resolved through the user's CURRENT role. */
  actorUserId: string;
  /** The role held AT THE TIME. Frozen. */
  actorRole: Role | '';
  /** ISO timestamp. */
  timestamp: string;
  action: Action | 'transfer' | 'grant' | 'revoke' | 'correct' | 'restore-version';
  module: ModuleKey | 'permissions' | 'system';
  scopeType: ScopeType;
  scopeId: string;
  /** What was acted on: a row id, a grant id, a document id. */
  targetId: string;
  /** Rendered, not structural. '' when there was no prior value. */
  before: string;
  after: string;
  reason: string;
  /** Version number when the event produced one. 0 otherwise. */
  version: number;
  /** Set only on a correction: the event this one corrects. */
  correctsId?: string;
}

const KEY = 'pactum-audit';

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clean(v: any): AuditEvent | null {
  const id = str(v?.id).trim();
  if (!id) return null;
  return {
    id,
    actorUserId: str(v?.actorUserId) || 'unknown',
    actorRole: str(v?.actorRole) as Role | '',
    timestamp: str(v?.timestamp),
    action: str(v?.action) as AuditEvent['action'],
    module: str(v?.module) as AuditEvent['module'],
    scopeType: str(v?.scopeType) as ScopeType,
    scopeId: str(v?.scopeId),
    targetId: str(v?.targetId),
    before: str(v?.before),
    after: str(v?.after),
    reason: str(v?.reason),
    version: num(v?.version),
    correctsId: v?.correctsId ? str(v.correctsId) : undefined,
  };
}

/** Reads the trail. Newest last, in the order events happened. */
export function readAudit(): AuditEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(clean).filter((e): e is AuditEvent => e !== null);
  } catch {
    return [];
  }
}

export interface RecordInput {
  actorUserId: string;
  actorRole?: Role | '';
  action: AuditEvent['action'];
  module: AuditEvent['module'];
  scopeType?: ScopeType;
  scopeId?: string;
  targetId?: string;
  before?: string;
  after?: string;
  reason?: string;
  version?: number;
  correctsId?: string;
}

/**
 * Appends one event. THE ONLY WRITER.
 *
 * It reads the existing trail, adds to the end, and writes back. It
 * never replaces or removes an entry, and there is deliberately no code
 * path in this module that could.
 */
export function record(input: RecordInput): AuditEvent {
  const e: AuditEvent = {
    id: `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    actorUserId: input.actorUserId || 'unknown',
    actorRole: input.actorRole ?? '',
    timestamp: new Date().toISOString(),
    action: input.action,
    module: input.module,
    scopeType: input.scopeType ?? 'global',
    scopeId: str(input.scopeId),
    targetId: str(input.targetId),
    before: str(input.before),
    after: str(input.after),
    reason: str(input.reason),
    version: num(input.version),
    correctsId: input.correctsId,
  };
  try {
    const list = readAudit();
    localStorage.setItem(KEY, JSON.stringify([...list, e]));
  } catch { /* quota */ }
  return e;
}

/**
 * Corrects an earlier event by writing a new one beside it.
 *
 * The original is untouched and stays visible. Rule 11: an audit entry
 * is never edited, so a correction is an addition.
 */
export function correct(
  actorUserId: string, actorRole: Role | '', targetEventId: string,
  after: string, reason: string,
): AuditEvent | null {
  const original = readAudit().find(e => e.id === targetEventId);
  if (!original) return null;
  return record({
    actorUserId, actorRole,
    action: 'correct',
    module: original.module,
    scopeType: original.scopeType,
    scopeId: original.scopeId,
    targetId: original.targetId,
    before: original.after,
    after,
    reason,
    correctsId: targetEventId,
  });
}

/** Filters for the console. Pure; the trail itself is never narrowed. */
export function filterAudit(
  list: AuditEvent[],
  f: { module?: string; actor?: string; targetId?: string; q?: string } = {},
): AuditEvent[] {
  const q = (f.q || '').trim().toLowerCase();
  return list.filter(e => {
    if (f.module && e.module !== f.module) return false;
    if (f.actor && e.actorUserId !== f.actor) return false;
    if (f.targetId && e.targetId !== f.targetId) return false;
    if (q) {
      const hay = `${e.actorUserId} ${e.action} ${e.module} ${e.targetId} ${e.before} ${e.after} ${e.reason}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
