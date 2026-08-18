/**
 * ══════════════════════════════════════════════════════════════════════
 * PACTUM · THE MUTATION GATE — AUTHORIZATION IS NOT A HIDDEN BUTTON
 * ══════════════════════════════════════════════════════════════════════
 *
 * Rule 12: a permission check must live in the domain, not in the view.
 * Hiding a button stops nobody who opens a console, and PACTUM's whole
 * store is reachable from one.
 *
 * So every sensitive write goes through `mutate()`. It answers three
 * questions in order, and only then lets the write happen:
 *
 *     1. can()          may this user do this action, on this module,
 *                       in this scope, ON THIS DATE?
 *     2. record()       write the audit event — WHO, WHEN, WHAT,
 *                       BEFORE, AFTER, VERSION, REASON
 *     3. snapshot()     capture the new state as a version
 *
 * REFUSAL IS THE DEFAULT. If the check fails the callback is NEVER
 * INVOKED — the mutation does not run, half-run, or run and roll back.
 * A refusal is itself recorded, because an attempt to do something you
 * are not allowed to do is exactly the event an audit trail exists for.
 *
 * WHY THE EIGHT MODULES WERE NOT REWRITTEN
 * ----------------------------------------
 * BudgetModule and its seven siblings call `localStorage.setItem`
 * directly, in 163 places. Rewriting them would have meant reworking
 * eight financial modules that thirteen approved steps depend on — the
 * exact "do not redesign" this step forbids.
 *
 * This gate is therefore the enforcement point for everything that
 * routes through it, and the honest statement is that the eight legacy
 * modules do not yet route through it. That gap is REPORTED, not hidden.
 * Nothing here weakens an existing guard; it adds one that can be
 * adopted a module at a time without touching a single formula.
 * ══════════════════════════════════════════════════════════════════════
 */

import {
  can, roleOn, iso10,
  type ModuleKey, type Action, type AuthContext, type ScopeType,
} from './authz';
import { record } from './audit';
import { snapshot } from './recordVersions';

export interface MutateInput<T> {
  /** Who is asking. Never inferred from the UI. */
  actorUserId: string;
  module: ModuleKey;
  action: Action;
  /** Which project / sector the action lands on. */
  ctx?: AuthContext;
  /** Stable id of the thing being changed. */
  targetId: string;
  /** Rendered prior state. '' when creating. */
  before?: string;
  /** Rendered next state. */
  after?: string;
  reason?: string;
  /** The date the request is judged against. Defaults to today. */
  at?: string;
  /**
   * Supply to capture a version alongside the audit event. Omit for
   * actions that change no record — a view, an export.
   */
  version?: {
    projectId: string;
    recordId: string;
    data: Record<string, unknown>;
    changeSummary?: string;
  };
  /** Runs ONLY if authorization passed. */
  commit: () => T;
}

export interface MutateResult<T> {
  ok: boolean;
  /** 'forbidden' when the check refused. */
  reason?: 'forbidden';
  value?: T;
  auditId?: string;
  versionNumber?: number;
}

function scopeOf(ctx?: AuthContext): { scopeType: ScopeType; scopeId: string } {
  if (ctx?.projectId) return { scopeType: 'project', scopeId: ctx.projectId };
  if (ctx?.sectorId) return { scopeType: 'sector', scopeId: ctx.sectorId };
  return { scopeType: 'global', scopeId: '' };
}

export function mutate<T>(input: MutateInput<T>): MutateResult<T> {
  const at = input.at || iso10();
  const ctx = input.ctx || {};
  const { scopeType, scopeId } = scopeOf(ctx);
  const actorRole = roleOn(input.actorUserId, at);

  const allowed = can(input.actorUserId, input.module, input.action, ctx, at);

  if (!allowed) {
    /**
     * A refused attempt is recorded. Silence here would mean the one
     * event most worth seeing — somebody reaching for authority they do
     * not hold — is the only one that leaves no trace.
     */
    record({
      actorUserId: input.actorUserId,
      actorRole,
      action: input.action,
      module: input.module,
      scopeType, scopeId,
      targetId: input.targetId,
      before: input.before ?? '',
      after: '',
      reason: `REFUSED — no ${input.action} permission on ${input.module}` +
              (input.reason ? ` · ${input.reason}` : ''),
      version: 0,
    });
    return { ok: false, reason: 'forbidden' };
  }

  // Authorised. The write happens now, and only now.
  const value = input.commit();

  let versionNumber = 0;
  if (input.version) {
    const v = snapshot({
      module: input.module,
      projectId: input.version.projectId,
      recordId: input.version.recordId,
      data: input.version.data,
      modifiedBy: input.actorUserId,
      changeSummary: input.version.changeSummary,
    });
    versionNumber = v.version;
  }

  const ev = record({
    actorUserId: input.actorUserId,
    actorRole,
    action: input.action,
    module: input.module,
    scopeType, scopeId,
    targetId: input.targetId,
    before: input.before ?? '',
    after: input.after ?? '',
    reason: input.reason ?? '',
    version: versionNumber,
  });

  return { ok: true, value, auditId: ev.id, versionNumber };
}

/**
 * Read-side helper for the UI.
 *
 * The view may use this to disable a control, but disabling is a
 * courtesy, not the control itself — `mutate` refuses regardless of what
 * the screen showed.
 */
export function allowed(
  actorUserId: string, module: ModuleKey, action: Action,
  ctx: AuthContext = {}, at: string = iso10(),
): boolean {
  return can(actorUserId, module, action, ctx, at);
}
