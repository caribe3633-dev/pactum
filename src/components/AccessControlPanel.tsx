import React, { useMemo, useState } from 'react';
import {
  ShieldCheck, ArrowRightLeft, History, GitCompare, RotateCcw, Plus, Ban,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { useAuth, useUsers, useProjects } from '../lib/store';
import { useSectors } from '../lib/useMasterData';
import {
  readGrants, grant, transferGrant, revokeGrant, roleOn, isActiveOn, iso10,
  ensureRootAdmin,
  ROLES, MODULES, ACTIONS,
  type Grant, type Role, type ModuleKey, type Action, type ScopeType,
} from '../lib/authz';
import { readAudit, filterAudit } from '../lib/audit';
import { readVersions, historyOf, compare, restoreVersion } from '../lib/recordVersions';

/**
 * ══════════════════════════════════════════════════════════════════════
 * ACCESS CONTROL — the console for permissions, transfers, audit and
 * version history.
 *
 * Mounted INSIDE the existing Admin Console rather than replacing it.
 * The user table and the reset panel are untouched; this sits below them
 * and reuses the same field, badge and table classes, so nothing new
 * enters the visual language.
 *
 * WHAT THE SCREEN CANNOT DO
 * -------------------------
 * Nothing here is the security boundary. Every button calls the same
 * domain functions any other caller would, and those refuse on their own
 * terms. Hiding a control is a courtesy to the user, never the check —
 * see guardedMutation.ts.
 * ══════════════════════════════════════════════════════════════════════
 */

type Tab = 'assignments' | 'transfers' | 'audit' | 'versions';

export default function AccessControlPanel() {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  const t = (ar: string, en: string) => (isRtl ? ar : en);

  const { user } = useAuth();
  const { users } = useUsers();
  const { projects } = useProjects();
  const sectors = useSectors();

  const actor = user?.username || '';
  const [tab, setTab] = useState<Tab>('assignments');
  const [tick, setTick] = useState(0);
  const bump = () => setTick(x => x + 1);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  /**
   * Seed the founding admin BEFORE the first read.
   *
   * AdminPage also calls this, but from an effect — which runs AFTER
   * this component has already rendered from an empty store. The screen
   * therefore showed "Your role: NONE" and "Assignments 0" on the very
   * first visit, correcting itself only on the second. Seeding here, in
   * the same pass that reads, removes that window. `ensureRootAdmin` is
   * idempotent, so calling it from both places is harmless.
   */
  const grants = useMemo(() => {
    if (user?.role === 'admin' && user.username) ensureRootAdmin(user.username);
    return readGrants();
  }, [tick, user?.role, user?.username]);
  const audit = useMemo(() => readAudit(), [tick]);
  const versions = useMemo(() => readVersions(), [tick]);

  const today = iso10();
  const actorRole = useMemo(() => roleOn(actor, today, grants), [actor, grants, today]);

  // ── new assignment form ──
  const [f, setF] = useState({
    userId: '', role: 'engineer' as Role,
    scopeType: 'project' as ScopeType, scopeId: '',
    module: 'budget' as ModuleKey, actions: ['view'] as Action[],
    from: today, to: '', reason: '',
  });

  const sectorOfProject = (pid: string) =>
    sectors.find(s => (s.projectIds || []).includes(pid))?.id;

  const toggleAction = (a: Action) =>
    setF(x => ({ ...x, actions: x.actions.includes(a)
      ? x.actions.filter(y => y !== a) : [...x.actions, a] }));

  const submitGrant = () => {
    if (!f.userId || f.actions.length === 0) {
      setMsg({ tone: 'bad', text: t('اختر مستخدماً وإجراءً واحداً على الأقل.',
                                    'Pick a user and at least one action.') });
      return;
    }
    const ctx = f.scopeType === 'project'
      ? { projectId: f.scopeId, sectorId: sectorOfProject(f.scopeId) }
      : f.scopeType === 'sector' ? { sectorId: f.scopeId } : {};
    const r = grant(actor, {
      userId: f.userId, role: f.role, scopeType: f.scopeType, scopeId: f.scopeId,
      module: f.module, actions: f.actions,
      effectiveFrom: f.from, effectiveTo: f.to, reason: f.reason,
    }, ctx);
    bump();
    setMsg(r.ok
      ? { tone: 'ok', text: t('تم منح الصلاحية.', 'Permission granted.') }
      : { tone: 'bad', text: reasonText(r.reason || '', t) });
  };

  // ── transfer form ──
  const [tf, setTf] = useState({ grantId: '', toUser: '', from: today, reason: '' });
  const submitTransfer = () => {
    const g = grants.find(x => x.id === tf.grantId);
    if (!g || !tf.toUser) {
      setMsg({ tone: 'bad', text: t('اختر تعييناً ومستخدماً.', 'Pick an assignment and a user.') });
      return;
    }
    const ctx = g.scopeType === 'project'
      ? { projectId: g.scopeId, sectorId: sectorOfProject(g.scopeId) }
      : g.scopeType === 'sector' ? { sectorId: g.scopeId } : {};
    const r = transferGrant(actor, g.id, tf.toUser, tf.from, tf.reason, ctx);
    bump();
    setMsg(r.ok
      ? { tone: 'ok', text: t(`نُقلت الصلاحية إلى ${tf.toUser}. التعيين السابق محفوظ كسجل.`,
                              `Transferred to ${tf.toUser}. The previous assignment is kept as history.`) }
      : { tone: 'bad', text: reasonText(r.reason || '', t) });
  };

  const doRevoke = (g: Grant) => {
    const ctx = g.scopeType === 'project'
      ? { projectId: g.scopeId, sectorId: sectorOfProject(g.scopeId) }
      : g.scopeType === 'sector' ? { sectorId: g.scopeId } : {};
    const r = revokeGrant(actor, g.id, 'revoked from console', ctx);
    bump();
    setMsg(r.ok
      ? { tone: 'ok', text: t('أُنهيت الصلاحية. السجل محفوظ.', 'Permission ended. The record is kept.') }
      : { tone: 'bad', text: reasonText(r.reason || '', t) });
  };

  const scopeLabel = (g: { scopeType: ScopeType; scopeId: string }) => {
    if (g.scopeType === 'global') return t('عام', 'Global');
    if (g.scopeType === 'sector') {
      const s = sectors.find(x => x.id === g.scopeId);
      return `${t('قطاع', 'Sector')}: ${s ? (isRtl && s.nameAr ? s.nameAr : s.name) : g.scopeId}`;
    }
    const p = projects.find((x: any) => x.id === g.scopeId);
    return `${t('مشروع', 'Project')}: ${p ? (isRtl ? (p.nameAr || p.nameEn) : p.nameEn) : g.scopeId}`;
  };

  // ── version explorer ──
  const recordKeys = useMemo(() => {
    const seen = new Map<string, { module: ModuleKey; projectId: string; recordId: string }>();
    for (const v of versions) {
      seen.set(`${v.module}|${v.projectId}|${v.recordId}`,
               { module: v.module, projectId: v.projectId, recordId: v.recordId });
    }
    return Array.from(seen.values());
  }, [versions]);
  const [sel, setSel] = useState<string>('');
  const selParts = sel ? sel.split('|') : null;
  const selHistory = selParts
    ? historyOf(selParts[0] as ModuleKey, selParts[1], selParts[2]) : [];
  const [cmpA, setCmpA] = useState(0);
  const [cmpB, setCmpB] = useState(0);
  const cmp = selParts && cmpA && cmpB
    ? compare(selParts[0] as ModuleKey, selParts[1], selParts[2], cmpA, cmpB) : null;

  const doRestoreVersion = (n: number) => {
    if (!selParts) return;
    const r = restoreVersion(selParts[0] as ModuleKey, selParts[1], selParts[2], n, actor, 'from console');
    bump();
    setMsg(r.ok
      ? { tone: 'ok', text: t(`أُنشئت نسخة جديدة v${r.version?.version} من v${n}. لم يُحذف شيء.`,
                              `Created v${r.version?.version} from v${n}. Nothing was deleted.`) }
      : { tone: 'bad', text: t('تعذّرت الاستعادة.', 'Restore failed.') });
  };

  const field = 'bg-black/40 border border-white/[0.06] px-2 py-1.5 text-(length:--t-second) text-white focus:outline-none focus:border-primary transition-colors';

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-lg font-serif text-white flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          {t('التحكم في الوصول', 'Access Control')}
        </h2>
        <span className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground">
          {t('دورك', 'Your role')}: <span className="text-primary">{actorRole || t('لا شيء', 'none')}</span>
        </span>
      </div>
      <p className="text-(length:--t-body) text-muted-foreground mb-4 max-w-3xl">
        {t('الصلاحية = دور + نطاق + وحدة + إجراء + مدة. امتلاك الوحدة لا يعني امتلاك كل الإجراءات.',
           'A permission is Role + Scope + Module + Action + Time. Holding a module never grants all of its actions.')}
      </p>

      {msg && (
        <div className={cn('pactum-card p-3 mb-4 border-l-2 rtl:border-l-0 rtl:border-r-2',
                           msg.tone === 'ok' ? 'border-chart-4' : 'border-chart-3')}>
          <p className={cn('text-(length:--t-body)', msg.tone === 'ok' ? 'text-chart-4' : 'text-chart-3')}>
            {msg.text}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        {([
          { id: 'assignments' as Tab, icon: ShieldCheck,    ar: 'التعيينات', en: 'Assignments', n: grants.length },
          { id: 'transfers'   as Tab, icon: ArrowRightLeft, ar: 'النقل',     en: 'Transfers',   n: grants.filter(g => g.supersededBy).length },
          { id: 'audit'       as Tab, icon: History,        ar: 'سجل التدقيق', en: 'Audit',     n: audit.length },
          { id: 'versions'    as Tab, icon: GitCompare,     ar: 'النسخ',     en: 'Versions',    n: versions.length },
        ]).map(x => (
          <button key={x.id} onClick={() => setTab(x.id)}
                  className={cn('flex items-center gap-2 text-sm px-4 py-2 border transition-colors',
                    tab === x.id
                      ? 'bg-primary/10 border-primary text-primary'
                      : 'bg-black/40 border-white/10 text-white/60 hover:bg-white/5')}>
            <x.icon className="w-4 h-4" />
            {isRtl ? x.ar : x.en}
            <span className="font-mono opacity-70">{x.n}</span>
          </button>
        ))}
      </div>

      {/* ══════════════ ASSIGNMENTS ══════════════ */}
      {tab === 'assignments' && (
        <>
          <div className="pactum-card p-4 bg-black/30 border-l-2 rtl:border-l-0 rtl:border-r-2 border-primary mb-5">
            <h3 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">
              {t('تعيين جديد', 'New Assignment')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <select className={field} value={f.userId} onChange={e => setF({ ...f, userId: e.target.value })}>
                <option value="">{t('المستخدم…', 'User…')}</option>
                {users.map((u: any) => <option key={u.username} value={u.username}>{u.username}</option>)}
              </select>
              <select className={field} value={f.role} onChange={e => setF({ ...f, role: e.target.value as Role })}>
                {ROLES.map(x => <option key={x.value} value={x.value}>{isRtl ? x.ar : x.en}</option>)}
              </select>
              <select className={field} value={f.scopeType}
                      onChange={e => setF({ ...f, scopeType: e.target.value as ScopeType, scopeId: '' })}>
                <option value="global">{t('عام', 'Global')}</option>
                <option value="sector">{t('قطاع', 'Sector')}</option>
                <option value="project">{t('مشروع', 'Project')}</option>
              </select>
              <select className={field} value={f.scopeId} disabled={f.scopeType === 'global'}
                      onChange={e => setF({ ...f, scopeId: e.target.value })}>
                <option value="">{f.scopeType === 'global' ? '—' : t('اختر…', 'Choose…')}</option>
                {f.scopeType === 'sector' && sectors.map(s =>
                  <option key={s.id} value={s.id}>{isRtl && s.nameAr ? s.nameAr : s.name}</option>)}
                {f.scopeType === 'project' && projects.map((p: any) =>
                  <option key={p.id} value={p.id}>{isRtl ? (p.nameAr || p.nameEn) : p.nameEn}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <select className={field} value={f.module} onChange={e => setF({ ...f, module: e.target.value as ModuleKey })}>
                {MODULES.map(m => <option key={m.value} value={m.value}>{isRtl ? m.ar : m.en}</option>)}
              </select>
              <input type="date" dir="ltr" className={field} value={f.from}
                     onChange={e => setF({ ...f, from: e.target.value })} />
              <input type="date" dir="ltr" className={field} value={f.to}
                     onChange={e => setF({ ...f, to: e.target.value })}
                     title={t('اتركه فارغاً لصلاحية مفتوحة', 'Leave blank for open-ended')} />
              <input className={field} value={f.reason} placeholder={t('السبب', 'Reason')}
                     onChange={e => setF({ ...f, reason: e.target.value })} />
            </div>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <span className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground me-1">
                {t('الإجراءات', 'Actions')}
              </span>
              {ACTIONS.map(a => (
                <button key={a.value} onClick={() => toggleAction(a.value)}
                        className={cn('text-(length:--t-second) px-2.5 py-1 border transition-colors',
                          f.actions.includes(a.value)
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'bg-black/40 border-white/10 text-white/50 hover:bg-white/5')}>
                  {isRtl ? a.ar : a.en}
                </button>
              ))}
            </div>
            <button onClick={submitGrant}
                    className="flex items-center gap-2 text-sm bg-primary/10 border border-primary text-primary px-4 py-2 hover:bg-primary/20 transition-colors">
              <Plus className="w-4 h-4" />{t('منح', 'Grant')}
            </button>
          </div>

          <GrantTable grants={grants} today={today} isRtl={isRtl} t={t}
                      scopeLabel={scopeLabel} onRevoke={doRevoke} />
        </>
      )}

      {/* ══════════════ TRANSFERS ══════════════ */}
      {tab === 'transfers' && (
        <>
          <div className="pactum-card p-4 bg-black/30 border-l-2 rtl:border-l-0 rtl:border-r-2 border-primary mb-5">
            <h3 className="text-sm uppercase tracking-wider text-muted-foreground mb-1">
              {t('نقل صلاحية', 'Transfer a Permission')}
            </h3>
            <p className="text-(length:--t-body) text-muted-foreground mb-3">
              {t('النقل لا يمحو التاريخ. التعيين السابق يُغلق بتاريخ انتهاء ويبقى محفوظاً.',
                 'A transfer erases nothing. The outgoing assignment is closed with an end date and kept.')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <select className={field} value={tf.grantId} onChange={e => setTf({ ...tf, grantId: e.target.value })}>
                <option value="">{t('التعيين…', 'Assignment…')}</option>
                {grants.filter(g => !g.supersededBy && isActiveOn(g, today)).map(g => (
                  <option key={g.id} value={g.id}>
                    {g.userId} · {g.module} · {scopeLabel(g)}
                  </option>
                ))}
              </select>
              <select className={field} value={tf.toUser} onChange={e => setTf({ ...tf, toUser: e.target.value })}>
                <option value="">{t('إلى…', 'To…')}</option>
                {users.map((u: any) => <option key={u.username} value={u.username}>{u.username}</option>)}
              </select>
              <input type="date" dir="ltr" className={field} value={tf.from}
                     onChange={e => setTf({ ...tf, from: e.target.value })} />
              <input className={field} value={tf.reason} placeholder={t('السبب', 'Reason')}
                     onChange={e => setTf({ ...tf, reason: e.target.value })} />
            </div>
            <button onClick={submitTransfer}
                    className="flex items-center gap-2 text-sm bg-primary/10 border border-primary text-primary px-4 py-2 hover:bg-primary/20 transition-colors">
              <ArrowRightLeft className="w-4 h-4" />{t('نقل', 'Transfer')}
            </button>
          </div>

          <h3 className="text-sm uppercase tracking-wider text-muted-foreground mb-2">
            {t('التعيينات المنقولة (محفوظة)', 'Transferred assignments (retained)')}
          </h3>
          <GrantTable grants={grants.filter(g => g.supersededBy)} today={today}
                      isRtl={isRtl} t={t} scopeLabel={scopeLabel} />
        </>
      )}

      {/* ══════════════ AUDIT ══════════════ */}
      {tab === 'audit' && <AuditTable audit={audit} isRtl={isRtl} t={t} />}

      {/* ══════════════ VERSIONS ══════════════ */}
      {tab === 'versions' && (
        <>
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <select className={field} value={sel}
                    onChange={e => { setSel(e.target.value); setCmpA(0); setCmpB(0); }}>
              <option value="">{t('اختر سجلاً…', 'Choose a record…')}</option>
              {recordKeys.map(k => {
                const key = `${k.module}|${k.projectId}|${k.recordId}`;
                return <option key={key} value={key}>{k.module} · {k.recordId}</option>;
              })}
            </select>
            {selHistory.length > 1 && (
              <>
                <select className={field} value={cmpA} onChange={e => setCmpA(Number(e.target.value))}>
                  <option value={0}>{t('من نسخة…', 'From v…')}</option>
                  {selHistory.map(v => <option key={v.version} value={v.version}>v{v.version}</option>)}
                </select>
                <select className={field} value={cmpB} onChange={e => setCmpB(Number(e.target.value))}>
                  <option value={0}>{t('إلى نسخة…', 'To v…')}</option>
                  {selHistory.map(v => <option key={v.version} value={v.version}>v{v.version}</option>)}
                </select>
              </>
            )}
          </div>

          {cmp && cmp.from && cmp.to && (
            <div className="pactum-card p-4 mb-4 bg-black/30">
              <h3 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">
                v{cmp.from.version} → v{cmp.to.version}
              </h3>
              {cmp.changes.length === 0 ? (
                <p className="text-(length:--t-body) text-muted-foreground">{t('لا فرق.', 'No difference.')}</p>
              ) : (
                <div className="space-y-1.5">
                  {cmp.changes.map(c => (
                    <div key={c.field} className="flex items-center gap-3 text-(length:--t-second)">
                      <span className={cn('badge',
                        c.status === 'added' ? 'badge-gold'
                        : c.status === 'removed' ? 'badge-neutral' : 'badge-gold')}>
                        {c.status === 'added' ? t('مضاف', 'ADDED')
                         : c.status === 'removed' ? t('محذوف', 'REMOVED') : t('متغيّر', 'CHANGED')}
                      </span>
                      <span className="font-mono text-white">{c.field}</span>
                      <span className="font-mono text-muted-foreground number-ltr">
                        {c.before || '—'} → {c.after || '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selHistory.length > 0 && (
            <div className="ds-table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th className="col-pin">{t('النسخة', 'Version')}</th>
                    <th>{t('بواسطة', 'Modified By')}</th>
                    <th>{t('في', 'Modified At')}</th>
                    <th>{t('ملخص التغيير', 'Change Summary')}</th>
                    <th>{t('إجراء', 'Action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {selHistory.slice().reverse().map(v => (
                    <tr key={v.id}>
                      <td className="col-pin font-mono text-primary">
                        v{v.version}
                        {v.restoredFrom !== undefined && (
                          <span className="ms-2 text-(length:--t-micro) text-muted-foreground">
                            ← v{v.restoredFrom}
                          </span>
                        )}
                      </td>
                      <td className="font-mono text-muted-foreground">{v.modifiedBy}</td>
                      <td className="font-mono text-muted-foreground number-ltr whitespace-nowrap">
                        {v.modifiedAt.replace('T', ' ').slice(0, 16)}
                      </td>
                      <td className="text-white/80">{v.changeSummary}</td>
                      <td>
                        <button onClick={() => doRestoreVersion(v.version)}
                                className="flex items-center gap-1.5 text-(length:--t-second) bg-black/40 border border-white/10 px-2.5 py-1 hover:bg-white/5 transition-colors">
                          <RotateCcw className="w-3 h-3" />{t('استعادة', 'Restore')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function reasonText(reason: string, t: (ar: string, en: string) => string): string {
  switch (reason) {
    case 'cannot-grant-admin':
      return t('لا يمكنك منح صلاحية مدير نظام.', 'You cannot grant Admin.');
    case 'cannot-grant-sector-manager':
      return t('لا يمكنك منح صلاحية مدير قطاع.', 'You cannot grant Sector Manager.');
    case 'self-elevation':
      return t('لا يمكنك منح نفسك صلاحيات.', 'You cannot grant permissions to yourself.');
    case 'outside-scope':
      return t('هذا خارج نطاقك.', 'That is outside your scope.');
    case 'not-authorised':
      return t('لا تملك صلاحية منح الصلاحيات.', 'You are not authorised to grant permissions.');
    default:
      return t('طلب غير صالح.', 'Invalid request.');
  }
}

function GrantTable({ grants, today, isRtl, t, scopeLabel, onRevoke }: {
  grants: Grant[]; today: string; isRtl: boolean;
  t: (ar: string, en: string) => string;
  scopeLabel: (g: Grant) => string;
  onRevoke?: (g: Grant) => void;
}) {
  if (grants.length === 0) {
    return <p className="text-(length:--t-body) text-muted-foreground">
      {t('لا تعيينات.', 'No assignments.')}
    </p>;
  }
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">
        <thead>
          <tr>
            <th className="col-pin">{t('المستخدم', 'User')}</th>
            <th>{t('الدور', 'Role')}</th>
            <th>{t('النطاق', 'Scope')}</th>
            <th>{t('الوحدة', 'Module')}</th>
            <th>{t('الإجراءات', 'Actions')}</th>
            <th>{t('من', 'From')}</th>
            <th>{t('حتى', 'To')}</th>
            <th>{t('الحالة', 'State')}</th>
            {onRevoke && <th>{' '}</th>}
          </tr>
        </thead>
        <tbody>
          {grants.map(g => {
            const live = isActiveOn(g, today);
            return (
              <tr key={g.id}>
                <td className="col-pin font-mono text-white">{g.userId}</td>
                <td className="text-muted-foreground">{g.role}</td>
                <td className="text-muted-foreground">{scopeLabel(g)}</td>
                <td className="font-mono text-muted-foreground">{g.module}</td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    {g.actions.map(a => (
                      <span key={a} className="text-(length:--t-micro) tracking-widest text-primary/70 border border-primary/20 px-1 leading-[1.4]">
                        {a.toUpperCase()}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="font-mono text-muted-foreground number-ltr whitespace-nowrap">{g.effectiveFrom || '—'}</td>
                <td className="font-mono text-muted-foreground number-ltr whitespace-nowrap">{g.effectiveTo || '—'}</td>
                <td>
                  <span className={cn('badge', g.supersededBy ? 'badge-neutral' : live ? 'badge-gold' : 'badge-neutral')}>
                    {g.supersededBy ? t('منقولة', 'TRANSFERRED') : live ? t('سارية', 'ACTIVE') : t('منتهية', 'EXPIRED')}
                  </span>
                </td>
                {onRevoke && (
                  <td>
                    {!g.supersededBy && live && (
                      <button onClick={() => onRevoke(g)}
                              className="flex items-center gap-1.5 text-(length:--t-second) bg-black/40 border border-white/10 px-2.5 py-1 hover:bg-white/5 transition-colors">
                        <Ban className="w-3 h-3" />{t('إنهاء', 'End')}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AuditTable({ audit, isRtl, t }: {
  audit: ReturnType<typeof readAudit>; isRtl: boolean; t: (ar: string, en: string) => string;
}) {
  const [q, setQ] = useState('');
  const [mod, setMod] = useState('');
  const rows = useMemo(() => filterAudit(audit, { q, module: mod || undefined }).slice().reverse(),
                       [audit, q, mod]);
  const field = 'bg-black/40 border border-white/[0.06] px-2 py-1.5 text-(length:--t-second) text-white focus:outline-none focus:border-primary transition-colors';

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <input className={cn(field, 'w-64')} value={q} onChange={e => setQ(e.target.value)}
               placeholder={t('بحث…', 'Search…')} />
        <select className={field} value={mod} onChange={e => setMod(e.target.value)}>
          <option value="">{t('كل الوحدات', 'All modules')}</option>
          {MODULES.map(m => <option key={m.value} value={m.value}>{isRtl ? m.ar : m.en}</option>)}
          <option value="permissions">{t('الصلاحيات', 'Permissions')}</option>
        </select>
        <span className="text-(length:--t-second) text-muted-foreground">
          {t('سجل التدقيق للقراءة فقط — لا يمكن تعديله أو حذفه.',
             'The audit trail is read-only — it cannot be edited or deleted.')}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-(length:--t-body) text-muted-foreground">{t('لا أحداث.', 'No events.')}</p>
      ) : (
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th className="col-pin">{t('الوقت', 'When')}</th>
                <th>{t('الفاعل', 'Actor')}</th>
                <th>{t('الدور وقتها', 'Role at time')}</th>
                <th>{t('الإجراء', 'Action')}</th>
                <th>{t('الوحدة', 'Module')}</th>
                <th>{t('الهدف', 'Target')}</th>
                <th>{t('قبل', 'Before')}</th>
                <th>{t('بعد', 'After')}</th>
                <th>v</th>
                <th>{t('السبب', 'Reason')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(e => (
                <tr key={e.id}>
                  <td className="col-pin font-mono text-muted-foreground number-ltr whitespace-nowrap">
                    {e.timestamp.replace('T', ' ').slice(0, 16)}
                  </td>
                  <td className="font-mono text-white">{e.actorUserId}</td>
                  <td className="text-muted-foreground">{e.actorRole || '—'}</td>
                  <td>
                    <span className={cn('badge', e.reason.startsWith('REFUSED') ? 'badge-neutral' : 'badge-gold')}>
                      {e.action.toUpperCase()}
                    </span>
                  </td>
                  <td className="font-mono text-muted-foreground">{e.module}</td>
                  <td className="font-mono text-muted-foreground">{e.targetId || '—'}</td>
                  <td className="font-mono text-muted-foreground number-ltr">{e.before || '—'}</td>
                  <td className="font-mono text-white/80 number-ltr">{e.after || '—'}</td>
                  <td className="font-mono text-muted-foreground">{e.version || '—'}</td>
                  <td className={cn('text-(length:--t-second)',
                                    e.reason.startsWith('REFUSED') ? 'text-chart-3' : 'text-muted-foreground')}>
                    {e.reason || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
