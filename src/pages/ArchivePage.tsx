import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Archive, RotateCcw, Search, Eye, Layers, HardHat, History, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/i18n';
import { useProjects, useAuth } from '../lib/store';
import { useSectors, useCompanies } from '../lib/useMasterData';
import { restoreSector } from '../lib/masterData';
import { formatDateOrDash } from '../lib/dateFormat';
import ContextBar from '../components/ContextBar';

/**
 * ══════════════════════════════════════════════════════════════════════
 * THE ARCHIVE — RETIRED, NOT DELETED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Archiving was already implemented across the data layer and was
 * reachable from nowhere: `archiveProject`, `archiveSector` and their
 * restores all existed, but there was no screen that listed what had
 * been archived. Work disappeared and could only be recovered by
 * knowing a URL. This is that screen.
 *
 * WHAT ARCHIVING DOES NOT DO
 * --------------------------
 * It sets `status` and writes an audit entry. That is all. No storage
 * key is touched, so every one of these survives untouched:
 *
 *     pactum-evm-{p}        periods, PV, EV, AC, frozen snapshots
 *     pactum-baselines-{p}  approved packages and their history
 *     pactum-budget-{p}     the cost plan
 *     pactum-co-{p}         change orders
 *     pactum-claims-{p}     claims
 *     pactum-cashflow-{p}   the funding plan
 *
 * An archived project's EVM is byte-identical to what it was the second
 * before it was archived, and it keeps feeding sector and portfolio
 * history exactly as before. Archiving is a VISIBILITY decision, never
 * a financial one.
 *
 * RESTORE APPENDS, IT DOES NOT ERASE
 * ----------------------------------
 * `unarchiveProject` used to delete `archivedAt` and `archivedBy`, so
 * reversing an archive destroyed the evidence that it had happened.
 * Both entities now carry an append-only `archiveLog`, and the History
 * column below reads it. A project archived, restored and archived
 * again shows all three events, in order.
 * ══════════════════════════════════════════════════════════════════════
 */

type Tab = 'projects' | 'sectors';

export default function ArchivePage() {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  const t = (ar: string, en: string) => (isRtl ? ar : en);
  const [, setLocation] = useLocation();

  const { user } = useAuth();
  const { projects, unarchiveProject } = useProjects();
  const sectors = useSectors();
  const companies = useCompanies();

  const [tab, setTab] = useState<Tab>('projects');
  const [q, setQ] = useState('');
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [tick, setTick] = useState(0);

  const companyName = (id?: string) => {
    const c = companies.find(x => x.id === id);
    return c ? (isRtl && c.nameAr ? c.nameAr : c.name) : '—';
  };

  const needle = q.trim().toLowerCase();
  const match = (...parts: (string | undefined)[]) =>
    !needle || parts.some(p => (p || '').toLowerCase().includes(needle));

  const archivedProjects = useMemo(
    () => projects.filter((p: any) => p.status === 'Archived')
      .filter((p: any) => match(p.nameEn, p.nameAr, p.code)),
    [projects, needle],
  );

  const archivedSectors = useMemo(
    () => sectors.filter(s => s.status === 'Archived')
      .filter(s => match(s.name, s.nameAr, companyName(s.companyId))),
    [sectors, needle, companies, tick],
  );

  const who = user?.username || 'unknown';

  const doRestoreProject = (p: any) => {
    unarchiveProject(p.id, who, '');
    setNotice({ tone: 'ok', text: t(`أُعيد "${p.nameAr || p.nameEn}" إلى النشاط.`,
                                    `"${p.nameEn}" restored to Active.`) });
  };

  const doRestoreSector = (s: any) => {
    const r = restoreSector(s.id, who, '');
    setTick(x => x + 1);
    if (r.ok) {
      setNotice({ tone: 'ok', text: t(`أُعيد القطاع "${s.name}" إلى النشاط.`,
                                      `Sector "${s.name}" restored to Active.`) });
    } else {
      // The refusal is shown verbatim. A restore blocked by an archived
      // parent is a real rule, not a glitch, and the user needs the reason.
      setNotice({
        tone: 'bad',
        text: (r.blockers && r.blockers.length)
          ? r.blockers.join(' · ')
          : t('تعذّرت الاستعادة.', 'Restore refused.'),
      });
    }
  };

  const logOf = (e: any): { action: string; at: string; by: string; note: string }[] => {
    const log = Array.isArray(e?.archiveLog) ? e.archiveLog : [];
    if (log.length === 0 && e?.archivedAt) {
      return [{ action: 'archived', at: e.archivedAt, by: e.archivedBy || 'unknown', note: '' }];
    }
    return log;
  };

  const count = tab === 'projects' ? archivedProjects.length : archivedSectors.length;

  return (
    <div className="page">
      <ContextBar
        items={[{ label: t('الأرشيف', 'Archive') }]}
        to="/enterprise-portfolio"
        backLabel={t('محفظة المشاريع', 'Enterprise Portfolio')}
      />

      <div className="page-body">
        <div className="mb-6">
          <div className="text-(length:--t-label) uppercase tracking-widest text-primary/70 mb-1">
            {t('محفوظ', 'Retained')}
          </div>
          <h1 className="page-title flex items-center gap-3">
            <Archive className="w-6 h-6 text-primary" />
            {t('الأرشيف', 'Archive')}
          </h1>
          <p className="text-(length:--t-body) text-muted-foreground mt-2 max-w-3xl">
            {t('الأرشفة ليست حذفاً. كل البيانات المالية وفترات القيمة المكتسبة وخطط الأساس تبقى كما هي بالضبط، وتستمر في تغذية تقارير القطاع والمحفظة التاريخية.',
               'Archiving is not deletion. All financial data, EVM periods and baselines remain exactly as they were, and continue to feed sector and portfolio historical reporting.')}
          </p>
        </div>

        {notice && (
          <div className={cn('ds-card ds-card-tight mb-4',
                             notice.tone === 'ok' ? 'border-chart-4/40' : 'border-chart-3/40')}>
            <p className={cn('text-(length:--t-body)',
                             notice.tone === 'ok' ? 'text-chart-4' : 'text-chart-3')}>
              {notice.tone === 'bad' && <AlertTriangle className="w-3.5 h-3.5 inline me-1.5" />}
              {notice.text}
            </p>
          </div>
        )}

        {/* ── tabs + search ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-2">
            {([
              { id: 'projects' as Tab, icon: HardHat, ar: 'المشاريع المؤرشفة', en: 'Archived Projects', n: projects.filter((p: any) => p.status === 'Archived').length },
              { id: 'sectors' as Tab, icon: Layers, ar: 'القطاعات المؤرشفة', en: 'Archived Sectors', n: sectors.filter(s => s.status === 'Archived').length },
            ]).map(x => (
              <button key={x.id} onClick={() => { setTab(x.id); setOpenLog(null); }}
                      className={cn('btn btn-sm', tab === x.id ? 'btn-primary' : 'btn-secondary')}>
                <x.icon className="w-3.5 h-3.5" />
                {isRtl ? x.ar : x.en}
                <span className="ms-1.5 font-mono opacity-70">{x.n}</span>
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('بحث…', 'Search…')}
              className="bg-black/40 border border-white/[0.06] ps-8 pe-3 py-1.5 text-(length:--t-second) text-white focus:outline-none focus:border-primary transition-colors w-64"
            />
          </div>
        </div>

        {count === 0 ? (
          <div className="ds-card ds-card-tight">
            <p className="text-(length:--t-body) text-muted-foreground">
              {needle
                ? t('لا نتائج مطابقة للبحث.', 'Nothing matches that search.')
                : tab === 'projects'
                  ? t('لا توجد مشاريع مؤرشفة.', 'No archived projects.')
                  : t('لا توجد قطاعات مؤرشفة.', 'No archived sectors.')}
            </p>
          </div>
        ) : (
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="col-pin">{tab === 'projects' ? t('المشروع', 'Project') : t('القطاع', 'Sector')}</th>
                  <th>{tab === 'projects' ? t('الكود', 'Code') : t('الشركة', 'Company')}</th>
                  <th>{t('أُرشِف في', 'Archived At')}</th>
                  <th>{t('أُرشِف بواسطة', 'Archived By')}</th>
                  <th>{t('السجل', 'History')}</th>
                  <th>{t('إجراء', 'Action')}</th>
                </tr>
              </thead>
              <tbody>
                {tab === 'projects' && archivedProjects.map((p: any) => {
                  const log = logOf(p);
                  const open = openLog === p.id;
                  return (
                    <React.Fragment key={p.id}>
                      <tr>
                        <td className="col-pin font-mono text-white">{isRtl ? (p.nameAr || p.nameEn) : p.nameEn}</td>
                        <td className="font-mono text-muted-foreground">{p.code || '—'}</td>
                        <td className="font-mono text-muted-foreground number-ltr whitespace-nowrap">
                          {p.archivedAt ? formatDateOrDash(String(p.archivedAt).slice(0, 10), isRtl ? 'ar' : 'en') : '—'}
                        </td>
                        <td className="font-mono text-muted-foreground">{p.archivedBy || '—'}</td>
                        <td>
                          <button onClick={() => setOpenLog(open ? null : p.id)}
                                  className="btn btn-secondary btn-sm" disabled={log.length === 0}>
                            <History className="w-3 h-3" />
                            {log.length}
                          </button>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            {/* View works while archived: the record is intact. */}
                            <Link href={`/project/${p.id}`}>
                              <button className="btn btn-secondary btn-sm">
                                <Eye className="w-3 h-3" />{t('عرض', 'View')}
                              </button>
                            </Link>
                            <button onClick={() => doRestoreProject(p)} className="btn btn-primary btn-sm">
                              <RotateCcw className="w-3 h-3" />{t('استعادة', 'Restore')}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={6} className="bg-black/30">
                            <ArchiveLog log={log} isRtl={isRtl} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {tab === 'sectors' && archivedSectors.map((s: any) => {
                  const log = logOf(s);
                  const open = openLog === s.id;
                  return (
                    <React.Fragment key={s.id}>
                      <tr>
                        <td className="col-pin font-mono text-white">{isRtl && s.nameAr ? s.nameAr : s.name}</td>
                        <td className="text-muted-foreground">{companyName(s.companyId)}</td>
                        <td className="font-mono text-muted-foreground number-ltr whitespace-nowrap">
                          {s.archivedAt ? formatDateOrDash(String(s.archivedAt).slice(0, 10), isRtl ? 'ar' : 'en') : '—'}
                        </td>
                        <td className="font-mono text-muted-foreground">{s.archivedBy || '—'}</td>
                        <td>
                          <button onClick={() => setOpenLog(open ? null : s.id)}
                                  className="btn btn-secondary btn-sm" disabled={log.length === 0}>
                            <History className="w-3 h-3" />
                            {log.length}
                          </button>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Link href={`/sector/${s.id}`}>
                              <button className="btn btn-secondary btn-sm">
                                <Eye className="w-3 h-3" />{t('عرض', 'View')}
                              </button>
                            </Link>
                            <button onClick={() => doRestoreSector(s)} className="btn btn-primary btn-sm">
                              <RotateCcw className="w-3 h-3" />{t('استعادة', 'Restore')}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={6} className="bg-black/30">
                            <ArchiveLog log={log} isRtl={isRtl} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** The append-only trail. Oldest first, so it reads as a story. */
function ArchiveLog({ log, isRtl }: { log: any[]; isRtl: boolean }) {
  const t = (ar: string, en: string) => (isRtl ? ar : en);
  if (!log.length) {
    return <p className="text-(length:--t-second) text-muted-foreground p-3">
      {t('لا سجل.', 'No history.')}
    </p>;
  }
  return (
    <div className="p-3 space-y-1.5">
      {log.map((e, i) => (
        <div key={i} className="flex items-center gap-3 text-(length:--t-second)">
          <span className={cn('badge', e.action === 'archived' ? 'badge-neutral' : 'badge-gold')}>
            {e.action === 'archived' ? t('أُرشِف', 'ARCHIVED') : t('أُعيد', 'RESTORED')}
          </span>
          <span className="font-mono text-muted-foreground number-ltr">
            {String(e.at || '').replace('T', ' ').slice(0, 16)}
          </span>
          <span className="text-white/70">{e.by || 'unknown'}</span>
          {e.note && <span className="text-muted-foreground italic">{e.note}</span>}
        </div>
      ))}
    </div>
  );
}
