import React, { useCallback, useMemo, useState } from 'react';
import {
  GitBranch, Check, Send, Plus, AlertTriangle, Lock, History, Trash2, Ban, Undo2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { useAuth } from '../lib/store';
import { formatDateOrDash } from '../lib/dateFormat';
import {
  readSourceVersions, versionsOf, approvedOf, draftOf, submittedOf, openOf,
  createVersion, updateDraft, submitVersion, approveVersion, deleteDraft,
  rejectVersion, returnVersion,
  versionLabel, nextVersionNumber, nextRevisionNumber,
  divergenceOf, refsReadiness, readLiveSource, EMPTY_IS_A_STATEMENT,
  SOURCE_KINDS, SOURCE_LABELS, STATUS_LABELS,
  type SourceKind, type SourceVersion, type SourceStatus, type SourceRefusal,
} from '../lib/sourceVersions';

/**
 * ══════════════════════════════════════════════════════════════════════
 * SOURCE VERSIONS — ONE PANEL, FIVE INDEPENDENT VERSION LINES
 * ══════════════════════════════════════════════════════════════════════
 *
 * Budget V3 · Cash Flow V2 · EVM Planned V4 · Claims V2 · Change Orders V7
 *
 * The panel shows them SIDE BY SIDE AND UNALIGNED, because they are.
 * A grid that made the numbers line up would be implying a relationship
 * the system does not have, and the first question it would provoke —
 * "why is Cash Flow behind?" — has no answer, because being behind is
 * not a thing a source can be.
 *
 * NO NEW VISUAL LANGUAGE. Existing `ds-card`, `kpi`, `ds-table`, `badge`
 * and `btn` classes only. Dates go through `formatDateOrDash`, so they
 * read "1 August 2026" like every other date in PACTUM, and an absent
 * one renders "—" rather than a fabricated zero.
 *
 * EVERY BUTTON IS A DELIBERATE, NAMED ACT. Capture, submit and approve
 * are three separate presses by design — collapsing them is how a plan
 * gets committed to by accident.
 * ══════════════════════════════════════════════════════════════════════
 */

const STATUS_BADGE: Record<SourceStatus, string> = {
  'draft':      'badge-neutral',
  'submitted':  'badge-warn',
  'approved':   'badge-ok',
  'superseded': 'badge-neutral',
  // A refusal is a risk-toned fact, not a neutral one. It reads at a
  // glance as "this plan was turned down", which is what happened.
  'rejected':   'badge-risk',
};

/** Every refusal the engine can return, in both languages. Never generic. */
const REFUSAL: Record<SourceRefusal, { en: string; ar: string }> = {
  'no-project':          { en: 'No project in scope.', ar: 'لا يوجد مشروع محدد.' },
  'unknown-kind':        { en: 'Unknown source.', ar: 'مصدر غير معروف.' },
  'not-found':           { en: 'That version no longer exists.', ar: 'هذه النسخة لم تعد موجودة.' },
  'open-version-exists': {
    en: 'A draft or submitted version is already open for this source. Finish it first.',
    ar: 'توجد مسودة أو نسخة مُقدَّمة مفتوحة لهذا المصدر. أنهِها أولاً.' },
  'not-a-draft':         { en: 'Only a draft can be changed.', ar: 'المسودة فقط هي التي يمكن تعديلها.' },
  'not-submitted':       { en: 'Only a submitted version can be approved.', ar: 'النسخة المُقدَّمة فقط هي التي تُعتمد.' },
  'approved-immutable':  {
    en: 'An approved version is immutable. Create the next version instead.',
    ar: 'النسخة المعتمدة غير قابلة للتعديل. أنشئ النسخة التالية بدلاً من ذلك.' },
  'empty-snapshot':      {
    en: 'This register is empty because nobody has entered it yet, not because it is nil. Enter the plan first — NO DATA is not zero.',
    ar: 'هذا السجل فارغ لأنه لم يُدخَل بعد، لا لأنه معدوم. أدخل الخطة أولاً — غياب البيانات ليس صفراً.' },
  'already-rejected':    {
    en: 'This attempt was already rejected. It stays on record; create the next revision instead.',
    ar: 'هذه المحاولة مرفوضة بالفعل. تبقى مسجَّلة — أنشئ المراجعة التالية بدلاً منها.' },
  'nothing-to-reject':   {
    en: 'Only a draft or a submitted version can be rejected.',
    ar: 'المسودة أو النسخة المُقدَّمة فقط هي التي تُرفض.' },
  'not-submitted-cannot-return': {
    en: 'Only a submitted version can be returned for revision.',
    ar: 'النسخة المُقدَّمة فقط هي التي تُعاد للتعديل.' },
};

export interface SourceVersionsPanelProps {
  projectId: string;
  /** Limit the panel to one source. Omit to show all five. */
  only?: SourceKind;
  /** False renders read-only: history is visible, no action is offered. */
  canEdit?: boolean;
  /** Compact form for embedding inside a module screen. */
  compact?: boolean;
}

export default function SourceVersionsPanel({
  projectId, only, canEdit = true, compact = false,
}: SourceVersionsPanelProps) {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  const t = (ar: string, en: string) => (isRtl ? ar : en);
  const { user } = useAuth();

  // A counter, not the store: every mutation returns the next store and
  // this forces the re-read, so the screen can never show a state the
  // engine did not produce.
  const [tick, setTick] = useState(0);
  const [msg, setMsg] = useState<{ kind: SourceKind; text: string; bad: boolean } | null>(null);
  const [expanded, setExpanded] = useState<SourceKind | null>(null);
  const [note, setNote] = useState('');

  const kinds = useMemo(() => (only ? [only] : SOURCE_KINDS), [only]);

  const store = useMemo(() => readSourceVersions(projectId), [projectId, tick]);
  const readiness = useMemo(() => refsReadiness(projectId), [projectId, tick]);

  const actor = useMemo(
    () => ({ userId: (user as any)?.username || (user as any)?.id || 'unknown' }),
    [user],
  );

  const after = useCallback((kind: SourceKind, res: { ok: boolean; reason?: SourceRefusal }, okText: string) => {
    if (res.ok) {
      setMsg({ kind, text: okText, bad: false });
      setNote('');
    } else {
      const r = res.reason && REFUSAL[res.reason];
      setMsg({
        kind,
        text: r ? t(r.ar, r.en) : t('تعذّر تنفيذ الإجراء.', 'The action could not be completed.'),
        bad: true,
      });
    }
    setTick(n => n + 1);
  }, [isRtl]);

  const doCreate = (kind: SourceKind) => {
    const res = createVersion({ projectId, kind, actor, note });
    after(kind, res, t(
      `تم إنشاء ${SOURCE_LABELS[kind].ar} V${res.version?.version} كمسودة.`,
      `${SOURCE_LABELS[kind].en} V${res.version?.version} created as a draft.`));
  };

  const doRecapture = (kind: SourceKind, v: SourceVersion) => {
    const res = updateDraft({ projectId, versionId: v.id, actor, note });
    after(kind, res, t(
      `تم تحديث المسودة ${versionLabel(v)} من السجل الحي — ما زالت ${versionLabel(v)} مسودة.`,
      `Draft ${versionLabel(v)} re-captured from the live register — still ${versionLabel(v)} Draft.`));
  };

  const doSubmit = (kind: SourceKind, v: SourceVersion) => {
    const res = submitVersion({ projectId, versionId: v.id, actor, note });
    after(kind, res, t(`تم تقديم ${versionLabel(v)}.`, `${versionLabel(v)} submitted.`));
  };

  /**
   * Discarding a draft asks first. Not because the engine needs it —
   * `deleteDraft` refuses anything that is not a draft — but because a
   * destructive click with no confirmation is how a morning's work
   * disappears.
   */
  const doDiscard = (kind: SourceKind, v: SourceVersion) => {
    const ok = window.confirm(t(
      `حذف مسودة ${SOURCE_LABELS[kind].ar} ${versionLabel(v)}؟ لم تُقدَّم ولم تُعتمد، ولا يوجد خط أساس مرتبط بها. سيبقى الحذف مسجَّلاً في سجل التدقيق.`,
      `Discard ${SOURCE_LABELS[kind].en} ${versionLabel(v)} draft? It was never submitted or approved and no baseline is bound to it. The discard stays on the audit trail.`));
    if (!ok) return;
    const res = deleteDraft({ projectId, versionId: v.id, actor, reason: note });
    after(kind, res, t(
      `تم حذف المسودة ${versionLabel(v)}. الحذف مسجَّل في سجل التدقيق.`,
      `Draft ${versionLabel(v)} discarded. The discard is recorded on the audit trail.`));
  };

  /**
   * Rejecting asks for a reason and refuses to proceed without one. A
   * refusal nobody explained is the one thing the next person cannot
   * act on — they know the plan was turned down and not why.
   */
  const doReject = (kind: SourceKind, v: SourceVersion) => {
    const why = (note || '').trim() || window.prompt(t(
      `سبب رفض ${SOURCE_LABELS[kind].ar} ${versionLabel(v)}؟`,
      `Why is ${SOURCE_LABELS[kind].en} ${versionLabel(v)} being rejected?`) as string) || '';
    if (!why.trim()) {
      setMsg({ kind, bad: true, text: t(
        'الرفض يحتاج سبباً. لم يُنفَّذ شيء.',
        'A rejection needs a reason. Nothing was changed.') });
      return;
    }
    const res = rejectVersion({ projectId, versionId: v.id, actor, reason: why });
    const nextV = res.ok ? nextVersionNumber(readSourceVersions(projectId), kind) : 0;
    const nextR = res.ok
      ? nextRevisionNumber(readSourceVersions(projectId), kind, nextV) : 0;
    after(kind, res, t(
      `تم رفض ${versionLabel(v)}. تبقى مسجَّلة. المحاولة التالية ستكون ${versionLabel({ version: nextV, revision: nextR })}.`,
      `${versionLabel(v)} rejected. It stays on record. The next attempt will be ${versionLabel({ version: nextV, revision: nextR })}.`));
  };

  /**
   * Return for revision — the middle answer. Needs a reason for the same
   * reason a rejection does: "send it back" without saying what to fix
   * is not a review comment, it is a delay.
   */
  const doReturn = (kind: SourceKind, v: SourceVersion) => {
    const why = (note || '').trim() || window.prompt(t(
      `ما المطلوب تعديله في ${SOURCE_LABELS[kind].ar} ${versionLabel(v)}؟`,
      `What needs changing in ${SOURCE_LABELS[kind].en} ${versionLabel(v)}?`) as string) || '';
    if (!why.trim()) {
      setMsg({ kind, bad: true, text: t(
        'الإعادة للتعديل تحتاج سبباً. لم يُنفَّذ شيء.',
        'Returning for revision needs a reason. Nothing was changed.') });
      return;
    }
    /* No success line here. The persistent banner below already states
       exactly this, and it stays visible until the draft is resubmitted.
       Printing both put the same sentence on screen twice, in two
       different colours, which reads as two separate events. */
    const res = returnVersion({ projectId, versionId: v.id, actor, reason: why });
    if (!res.ok) { after(kind, res, ''); return; }
    setMsg(null);
    setNote('');
    setTick(n => n + 1);
  };

  const doApprove = (kind: SourceKind, v: SourceVersion) => {
    const res = approveVersion({ projectId, versionId: v.id, actor, note });
    after(kind, res, t(
      `تم اعتماد ${versionLabel(v)}. النسخ الأقدم لم تتغيّر.`,
      `${versionLabel(v)} approved. Earlier versions are unchanged.`));
  };

  return (
    <div className="pg-stack">

      {/* ── The binding, stated as five independent facts ──────────────── */}
      {!only && (
        <div className="ds-card ds-card-tight">
          <h3 className="sec-head">
            <GitBranch className="w-3.5 h-3.5 inline" />{' '}
            {t('النسخ المعتمدة للمصادر', 'Approved Source Versions')}
          </h3>
          <p className="text-(length:--t-second) text-muted mb-3">
            {t(
              'أرقام النسخ مستقلة لكل مصدر. المصدر الذي لم يتغيّر لا يكتسب نسخة جديدة، وتوحيد الأرقام كان سيسجّل حدثاً لم يقع.',
              'Version numbers are independent per source. A source that did not change does not gain a version, and forcing the numbers into step would record an event that never happened.')}
          </p>
          <div className="flex flex-wrap gap-2">
            {SOURCE_KINDS.map(k => {
              const a = approvedOf(store, k);
              return (
                <span key={k} className={cn('badge', a ? 'badge-gold' : 'badge-neutral')}>
                  {isRtl ? SOURCE_LABELS[k].ar : SOURCE_LABELS[k].en}{' '}
                  {a ? `V${a.version}` : '—'}
                </span>
              );
            })}
          </div>

          {/* Missing sources are NAMED. A count alone tells the user they
              are blocked without telling them by what. */}
          {readiness.missing.length > 0 && (
            <div className="ds-card border-chart-3/30 bg-chart-3/[0.05] !py-3 mt-3">
              <p className="text-(length:--t-second) text-chart-3">
                <AlertTriangle className="w-3.5 h-3.5 inline" />{' '}
                {t(
                  `لا يمكن بناء خط أساس: المصادر التالية ليس لها نسخة معتمدة — ${readiness.missing.map(k => SOURCE_LABELS[k].ar).join(' · ')}`,
                  `A baseline cannot be built: these sources have no approved version — ${readiness.missing.map(k => SOURCE_LABELS[k].en).join(' · ')}`)}
              </p>
            </div>
          )}

          {/* Stale is INFORMATION, not a refusal. Building from the
              approved snapshot while the register moves on is correct. */}
          {readiness.stale.length > 0 && (
            <div className="ds-card border-primary/25 bg-primary/[0.04] !py-3 mt-3">
              <p className="text-(length:--t-second) text-muted">
                {t(
                  `السجل الحي تغيّر بعد الاعتماد في: ${readiness.stale.map(k => SOURCE_LABELS[k].ar).join(' · ')}. خط الأساس يُبنى من النسخة المعتمدة، وليس من السجل الحي — أنشئ نسخة جديدة إذا أردت إدراج التغييرات.`,
                  `The live register has moved on since approval for: ${readiness.stale.map(k => SOURCE_LABELS[k].en).join(' · ')}. A baseline is built from the APPROVED version, not the live register — create a new version to include those changes.`)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── One block per source ───────────────────────────────────────── */}
      {kinds.map(kind => {
        const list = versionsOf(store, kind);
        const approved = approvedOf(store, kind);
        const draft = draftOf(store, kind);
        const submitted = submittedOf(store, kind);
        const open = openOf(store, kind);
        const div = divergenceOf(projectId, kind, store);
        const label = isRtl ? SOURCE_LABELS[kind].ar : SOURCE_LABELS[kind].en;
        const isOpen = only ? true : expanded === kind;

        return (
          <div key={kind} className="ds-card">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="sec-head !mb-0 flex-1">
                {label}
                {approved && (
                  <span className="badge badge-ok" style={{ marginInlineStart: '0.5rem' }}>
                    <Lock className="w-3 h-3" /> {versionLabel(approved)}
                  </span>
                )}
                {open && (
                  <span className={cn('badge', STATUS_BADGE[open.status])}
                        style={{ marginInlineStart: '0.5rem' }}>
                    {versionLabel(open)}{' '}
                    {isRtl ? STATUS_LABELS[open.status].ar : STATUS_LABELS[open.status].en}
                  </span>
                )}
              </h3>

              {!only && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setExpanded(expanded === kind ? null : kind)}>
                  <History className="w-3 h-3" />{' '}
                  {t('السجل', 'History')} ({list.length})
                </button>
              )}

              {canEdit && !open && (() => {
                /* The button says exactly what pressing it will produce.
                   After a rejection that is "V2 Rev 1", not "V3" — the
                   label is computed by the same engine that allocates
                   the number, so the two can never disagree. */
                const nv = nextVersionNumber(store, kind);
                const nr = nextRevisionNumber(store, kind, nv);
                const label = versionLabel({ version: nv, revision: nr });
                return (
                  <button className="btn btn-secondary btn-sm" onClick={() => doCreate(kind)}>
                    <Plus className="w-3 h-3" />{' '}
                    {t(`إنشاء ${label} مسودة`, `Create ${label} Draft`)}
                  </button>
                );
              })()}

              {canEdit && draft && (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={() => doRecapture(kind, draft)}>
                    {t('إعادة الالتقاط', 'Re-capture')}
                  </button>
                  {/* Only ever offered for a draft. An approved version has
                      no delete path at all, in the UI or the engine. */}
                  <button className="btn btn-secondary btn-sm" onClick={() => doDiscard(kind, draft)}
                          title={t('حذف المسودة', 'Discard draft')}>
                    <Trash2 className="w-3 h-3" /> {t('حذف', 'Discard')}
                  </button>
                  {/* A draft that has been submitted before is being
                      RESUBMITTED. Saying so tells the author this is a
                      round trip, not a first attempt. */}
                  <button className="btn btn-primary btn-sm" onClick={() => doSubmit(kind, draft)}>
                    <Send className="w-3 h-3" />{' '}
                    {(draft.submissionCount || 0) > 0
                      ? t('إعادة التقديم', 'Resubmit')
                      : t('تقديم', 'Submit')}
                  </button>
                </>
              )}

              {canEdit && submitted && (
                <>
                  {/* THREE answers, because a reviewer genuinely has
                      three. Return is the common one and sits first:
                      most comments are "fix this and resend", which is
                      neither an approval nor a refusal. */}
                  <button className="btn btn-secondary btn-sm" onClick={() => doReturn(kind, submitted)}
                          title={t('إعادة للتعديل دون احتسابها رفضاً',
                                   'Send back for revision — not counted as a rejection')}>
                    <Undo2 className="w-3 h-3" /> {t('إعادة للتعديل', 'Return for Revision')}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => doReject(kind, submitted)}>
                    <Ban className="w-3 h-3" /> {t('رفض', 'Reject')}
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => doApprove(kind, submitted)}>
                    <Check className="w-3 h-3" /> {t('اعتماد', 'Approve')}
                  </button>
                </>
              )}
            </div>

            {/* A draft that was sent back. The author needs to see WHY
                without opening a history table. */}
            {draft && (draft.submissionCount || 0) > 0 && (
              <p className="text-(length:--t-second) text-chart-3 mt-2">
                <Undo2 className="w-3.5 h-3.5 inline" />{' '}
                {t(
                  `${versionLabel(draft)} أُعيدت للتعديل — ما زالت ${versionLabel(draft)} ولم تُحتسب رفضاً. عدّلها ثم أعد تقديمها.`,
                  `${versionLabel(draft)} was returned for revision — still ${versionLabel(draft)}, not counted as a rejection. Edit it and resubmit.`)}
                {draft.note && <span className="text-muted-foreground"> · {draft.note}</span>}
              </p>
            )}

            {/* An empty CO/Claims register is a legitimate NIL RETURN.
                Say so explicitly, because the previous build refused it
                and the user reasonably read that as a dead end. */}
            {(() => {
              const live = readLiveSource(projectId, kind);
              const emptyNow = Array.isArray(live) && live.length === 0;
              if (!emptyNow || !EMPTY_IS_A_STATEMENT[kind]) return null;
              return (
                <p className="text-(length:--t-second) text-muted mt-2">
                  {t(
                    `لا توجد ${label} — وهذه إفادة صحيحة قابلة للاعتماد، وليست بيانات ناقصة. النسخة ستُسجَّل بصفر بند مع توضيح أنها "لا شيء بالإقرار"، ولن تُقرأ لاحقاً كخانة لم تُملأ.`,
                    `There are no ${label} — that is a valid, approvable statement, not missing data. The version records zero items and is marked "nil by declaration", so it can never later be read as a field nobody filled in.`)}
                </p>
              );
            })()}

            {/* Never versioned. Said plainly rather than shown as V0. */}
            {!div.versioned && (
              <p className="text-(length:--t-second) text-muted mt-2">
                {t(
                  'لم تُسجَّل أي نسخة لهذا المصدر. السجلات الحالية تبقى كما هي — لم يُخترع لها اعتماد ولا تاريخ ولا مستخدم. أول "إنشاء نسخة" يلتقطها كـ V1 مسودة.',
                  'No version has been recorded for this source. The existing records stay as they are — no approval, date or user has been invented for them. The first "Create Version" captures them as V1 Draft.')}
              </p>
            )}

            {/* The register has moved past what was approved. */}
            {div.diverged && (
              <p className="text-(length:--t-second) text-chart-3 mt-2">
                <AlertTriangle className="w-3.5 h-3.5 inline" />{' '}
                {t(
                  `السجل الحي يختلف عن V${div.approvedVersion} المعتمدة. V${div.approvedVersion} لم تتغيّر ولن تتغيّر.`,
                  `The live register differs from approved V${div.approvedVersion}. V${div.approvedVersion} has not changed and will not.`)}
              </p>
            )}

            {msg && msg.kind === kind && (
              <p className={cn('text-(length:--t-second) mt-2',
                               msg.bad ? 'text-destructive' : 'text-success')}>
                {msg.text}
              </p>
            )}

            {canEdit && isOpen && (
              <div className="field mt-3">
                <label className="field-label">{t('ملاحظة', 'Note')}</label>
                <input className="field-input" value={note}
                       onChange={e => setNote(e.target.value)}
                       placeholder={t('سبب هذه النسخة', 'Why this version exists')} />
              </div>
            )}

            {isOpen && list.length > 0 && (
              <div className="ds-table-wrap mt-3">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>{t('النسخة', 'Version')}</th>
                      <th>{t('الحالة', 'Status')}</th>
                      <th className="money">{t('صفوف', 'Rows')}</th>
                      <th>{t('أنشأها', 'Created By')}</th>
                      <th>{t('تاريخ الإنشاء', 'Created')}</th>
                      <th>{t('قدّمها', 'Submitted By')}</th>
                      <th>{t('تاريخ التقديم', 'Submitted')}</th>
                      <th className="money">{t('مرات التقديم', 'Submissions')}</th>
                      <th>{t('اعتمدها', 'Approved By')}</th>
                      <th>{t('تاريخ الاعتماد', 'Approved')}</th>
                      <th>{t('تحل محل', 'Supersedes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.slice().reverse().map(v => (
                      <tr key={v.id}>
                        <td className="col-pin">{versionLabel(v)}</td>
                        <td>
                          <span className={cn('badge', STATUS_BADGE[v.status])}>
                            {isRtl ? STATUS_LABELS[v.status].ar : STATUS_LABELS[v.status].en}
                          </span>
                        </td>
                        {/* Three distinct readings, never conflated:
                              a number   — that many rows
                              NIL        — declared empty, on purpose
                              —          — no row count applies (EVM) */}
                        <td className="money">
                          {v.rowCount > 0
                            ? v.rowCount
                            : v.emptyByDeclaration
                              ? <span className="badge badge-neutral">
                                  {t('لا شيء', 'NIL')}
                                </span>
                              : '—'}
                        </td>
                        <td>{v.createdBy || '—'}</td>
                        <td>{formatDateOrDash(v.createdAt, lang)}</td>
                        <td>{v.submittedBy || '—'}</td>
                        <td>{formatDateOrDash(v.submittedAt, lang)}</td>
                        {/* Never submitted shows a dash, not a 0. 2 means
                            it went for review, came back, and went again. */}
                        <td className="money">{v.submissionCount || '—'}</td>
                        <td>{v.approvedBy || '—'}</td>
                        <td>{formatDateOrDash(v.approvedAt, lang)}</td>
                        <td>{v.supersedesVersion === null ? '—' : `V${v.supersedesVersion}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {isOpen && list.length === 0 && (
              <p className="text-(length:--t-second) text-muted mt-3">
                {t('لا توجد نسخ.', 'No versions.')}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
