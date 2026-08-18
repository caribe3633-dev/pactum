import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Project } from '../../lib/data';
import { useProjectCurrency } from '../../lib/useProjectCurrency';
import { useTranslation } from '../../lib/i18n';
import { useProjects, useAuth } from '../../lib/store';
import { formatMoney } from '../../lib/utils';
import { abbrevMoney, exactMoney } from '../../lib/moneyFormat';
import { Plus, Trash2, Clock, AlertTriangle, CheckCircle, DollarSign, Link2, X, ChevronDown, ChevronUp, Scale, History, LayoutGrid, CalendarClock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { EditableNumber, EditableText, EditableSelect, EditableDate } from '../EditableCell';
import {
  computeApprovedEOT, computeLd, readLdLog, appendLdLog,
  buildLogEntry, ldSignature, LdLogEntry,
  sumCostImpact, computeNetCostImpact,
  syncDelayRegister, computeProgramme,
} from '../../lib/delayCalculations';
import {
  backfillWindows, readWindows, windowLabel, isWindowClosed, windowDelta,
  windowIdFor, DelayWindow, ProjectSnapshot, WindowDelayEvent,
} from '../../lib/delayWindows';
import { formatDate, formatDateOrDash, formatDateTime, parseAnyDate } from '../../lib/dateFormat';
import ReportButton from '../reporting/ReportButton';

// ── Types ────────────────────────────────────────────────────────────

export interface DelayRow {
  id: string;
  description: string;
  responsibleParty: string;
  startDate: string;
  endDate: string;
  delayDays: number;
  eotDays: number;
  costImpact: number;
  category: string;
  status: string;
  notes: string;
  linkedClaimNos?: string[];   // Cross-reference: IDs of related Claims
  linkedCoNos?: string[];      // Cross-reference: IDs of related Change Orders
}

interface ClaimRow { no: string; type: string; claimed: number; settled: number; timeDays: number; status: string; }
interface CORow { no: string; desc: string; value: number; time: number; status: string; }

// ── Options ──────────────────────────────────────────────────────────

const PARTY_OPTS = [
  { value: 'contractor',    label: 'Contractor' },
  { value: 'owner',         label: 'Owner' },
  { value: 'force_majeure', label: 'Force Majeure' },
  { value: 'third_party',   label: 'Third Party' },
];

const CATEGORY_OPTS = [
  { value: 'weather',      label: 'Weather' },
  { value: 'design',       label: 'Design' },
  { value: 'site_access',  label: 'Site Access' },
  { value: 'procurement',  label: 'Procurement' },
  { value: 'scope_change', label: 'Scope Change' },
  { value: 'third_party',  label: 'Third Party' },
  { value: 'utility',      label: 'Utility Relocation' },
];

const STATUS_OPTS = [
  { value: 'identified', label: 'Identified' },
  { value: 'submitted',  label: 'Submitted' },
  { value: 'review',     label: 'Under Review' },
  { value: 'approved',   label: 'Approved' },
  { value: 'rejected',   label: 'Rejected' },
];

function getStatusStyle(status: string) {
  switch (status) {
    case 'approved': return 'bg-chart-4/10 text-chart-4 border-chart-4/30';
    case 'review':   return 'bg-chart-5/10 text-chart-5 border-chart-5/30';
    case 'rejected': return 'bg-chart-3/10 text-chart-3 border-chart-3/30';
    case 'submitted':return 'bg-primary/10 text-primary border-primary/30';
    default:         return 'bg-white/5 text-muted-foreground border-white/10';
  }
}

function getClaimStatusStyle(status: string) {
  switch (status?.toLowerCase()) {
    case 'approved': return 'text-chart-4';
    case 'review':   return 'text-chart-5';
    case 'rejected': return 'text-chart-3';
    default:         return 'text-muted-foreground';
  }
}

// ── Exported helpers (used by portfolio engine) ──────────────────────

export function getDelayRows(projectId: string): DelayRow[] {
  const stored = localStorage.getItem(`pactum-delays-${projectId}`);
  return stored ? JSON.parse(stored) : [];
}

export function getProjectDelayDays(projectId: string): number {
  return getDelayRows(projectId).reduce((sum, r) => sum + (r.delayDays || 0), 0);
}

// ── Seed ─────────────────────────────────────────────────────────────

function seedData(project: Project): DelayRow[] {
  return [
    {
      id: 'DLY-001',
      description: 'Unforeseen ground conditions — excessive groundwater at pile caps',
      responsibleParty: 'owner', startDate: '15/01/2024', endDate: '20/02/2024',
      delayDays: 36, eotDays: 36, costImpact: 2800000, category: 'design', status: 'approved',
      notes: 'Geo-technical survey failed to identify water table depth. EOT approved by Engineer.',
      linkedClaimNos: ['CLM-001'],
    },
    {
      id: 'DLY-002',
      description: 'Structural steel import delay — Red Sea logistics disruption',
      responsibleParty: 'third_party', startDate: '05/03/2024', endDate: '25/04/2024',
      delayDays: 51, eotDays: 0, costImpact: 4100000, category: 'procurement', status: 'submitted',
      notes: 'Force majeure claim pending. Contractor submitted Notice of Delay per FIDIC 8.4.',
      linkedClaimNos: [],
    },
    {
      id: 'DLY-003',
      description: 'Delayed Owner instructions on facade specification',
      responsibleParty: 'owner', startDate: '10/05/2024', endDate: '30/05/2024',
      delayDays: 20, eotDays: 20, costImpact: 750000, category: 'design', status: 'approved',
      notes: 'Owner issued revised facade specification 20 days late. Prolongation claim to follow.',
      linkedClaimNos: [],
    },
    {
      id: 'DLY-004',
      description: 'Utility authority permit delay — MARAFIQ power connection',
      responsibleParty: 'third_party', startDate: '15/06/2024', endDate: '10/07/2024',
      delayDays: 25, eotDays: 0, costImpact: 1200000, category: 'utility', status: 'review',
      notes: 'Power connection approval delayed by MARAFIQ. Contractor notified Owner per Clause 8.4.',
      linkedClaimNos: [],
    },
  ];
}

// ── Linked Claims Panel ───────────────────────────────────────────────

interface LinkedDetailsPanelProps {
  /** SPRINT 3 · R5 — passed down; the panel has no project of its own. */
  ccy: string;
  delayRow: DelayRow;
  allClaims: ClaimRow[];
  allCOs: CORow[];
  canEdit: boolean;
  onLink: (delayId: string, claimNo: string) => void;
  onUnlink: (delayId: string, claimNo: string) => void;
  onLinkCo: (delayId: string, coNo: string) => void;
  onUnlinkCo: (delayId: string, coNo: string) => void;
}

/**
 * Details panel for one delay event.
 *
 * A delay event can be evidenced by BOTH a Time Claim and a Change Order that
 * carries a time extension. Both are linked here, on the same row, so the
 * event is never recorded twice. Purely financial change orders (time === 0)
 * are not offered for linking — they have no schedule impact.
 */
function LinkedDetailsPanel({
  delayRow, allClaims, allCOs, canEdit, onLink, onUnlink, onLinkCo, onUnlinkCo, ccy,
}: LinkedDetailsPanelProps) {
  const linked = (delayRow.linkedClaimNos || []);
  const linkedClaims = allClaims.filter(c => linked.includes(c.no));
  const available = allClaims.filter(c => !linked.includes(c.no));

  const linkedCo = ((delayRow as any).linkedCoNos as string[] | undefined) || [];
  // Only time-bearing change orders belong in the Delay Register.
  const timeCOs = allCOs.filter(c => (Number(c.time) || 0) > 0);
  const linkedCOs = timeCOs.filter(c => linkedCo.includes(c.no));
  const availableCOs = timeCOs.filter(c => !linkedCo.includes(c.no));

  const [showSelector, setShowSelector] = useState(false);
  const [showCoSelector, setShowCoSelector] = useState(false);

  const totalEotRequested =
    linkedClaims.reduce((a, c) => a + (c.timeDays || 0), 0) +
    linkedCOs.reduce((a, c) => a + (c.time || 0), 0);

  return (
    <div className="px-4 pb-4 pt-2 bg-black/30 border-t border-primary/10">

      {/* ── Time Claims ── */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-(length:--t-label) uppercase tracking-widest text-primary/60 font-mono">
          Linked Claims — {linkedClaims.length} linked
        </span>
        {canEdit && available.length > 0 && (
          <button
            onClick={() => { setShowSelector(v => !v); setShowCoSelector(false); }}
            className="flex items-center gap-1 text-(length:--t-micro) text-primary/70 hover:text-primary transition-colors border border-primary/20 hover:border-primary/40 px-2 py-1 uppercase tracking-wider"
          >
            <Link2 className="w-3 h-3" />
            {showSelector ? 'Cancel' : 'Link Claim'}
          </button>
        )}
      </div>

      {/* Selector */}
      {showSelector && (
        <div className="mb-3 grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {available.map(c => (
            <button
              key={c.no}
              onClick={() => { onLink(delayRow.id, c.no); setShowSelector(false); }}
              className="flex items-center justify-between text-xs bg-black/40 border border-white/10 hover:border-primary/40 px-3 py-2 text-start transition-colors group"
            >
              <span>
                <span className="font-mono text-primary mr-2">{c.no}</span>
                <span className="text-white/60">{c.type}</span>
              </span>
              <span className={cn('text-(length:--t-second) ml-2', getClaimStatusStyle(c.status))}>{c.status}</span>
            </button>
          ))}
        </div>
      )}

      {/* Linked list */}
      {linkedClaims.length === 0 ? (
        <p className="text-(length:--t-second) text-white/20 italic">No claims linked to this delay event.</p>
      ) : (
        <div className="space-y-1.5">
          {linkedClaims.map(c => (
            <div key={c.no} className="flex items-center gap-3 bg-black/20 border border-primary/10 px-3 py-2 text-xs">
              <span className="font-mono text-primary w-20 flex-shrink-0">{c.no}</span>
              <span className="text-white/70 flex-1">{c.type}</span>
              <span className="font-mono text-white/50">{formatMoney(c.claimed, { currency: ccy })}</span>
              <span className="font-mono text-primary/70 w-16 text-right flex-shrink-0">
                {c.timeDays > 0 ? `+${c.timeDays}d` : '—'}
              </span>
              <span className={cn('text-(length:--t-second) w-20 text-right', getClaimStatusStyle(c.status))}>{c.status}</span>
              {canEdit && (
                <button
                  onClick={() => onUnlink(delayRow.id, c.no)}
                  className="text-white/20 hover:text-chart-3 transition-colors ml-1 flex-shrink-0"
                  title="Remove link"
                  aria-label="Remove link"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Change Orders with schedule impact ── */}
      <div className="flex items-center justify-between mb-3 mt-4 pt-3 border-t border-white/5">
        <span className="text-(length:--t-label) uppercase tracking-widest text-chart-5/60 font-mono">
          Linked Change Orders — {linkedCOs.length} linked
        </span>
        {canEdit && availableCOs.length > 0 && (
          <button
            onClick={() => { setShowCoSelector(v => !v); setShowSelector(false); }}
            className="flex items-center gap-1 text-(length:--t-micro) text-chart-5/70 hover:text-chart-5 transition-colors border border-chart-5/20 hover:border-chart-5/40 px-2 py-1 uppercase tracking-wider"
          >
            <Link2 className="w-3 h-3" />
            {showCoSelector ? 'Cancel' : 'Link Change Order'}
          </button>
        )}
      </div>

      {/* CO selector — time-bearing change orders only */}
      {showCoSelector && (
        <div className="mb-3 grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {availableCOs.map(c => (
            <button
              key={c.no}
              onClick={() => { onLinkCo(delayRow.id, c.no); setShowCoSelector(false); }}
              className="flex items-center justify-between text-xs bg-black/40 border border-white/10 hover:border-chart-5/40 px-3 py-2 text-start transition-colors"
            >
              <span>
                <span className="font-mono text-chart-5 mr-2">{c.no}</span>
                <span className="text-white/60">{c.desc}</span>
              </span>
              <span className="font-mono text-(length:--t-data) text-primary/70 ml-2">+{c.time}d</span>
            </button>
          ))}
        </div>
      )}

      {linkedCOs.length === 0 ? (
        <p className="text-(length:--t-second) text-white/20 italic">No change orders linked to this delay event.</p>
      ) : (
        <div className="space-y-1.5">
          {linkedCOs.map(c => (
            <div key={c.no} className="flex items-center gap-3 bg-black/20 border border-chart-5/10 px-3 py-2 text-xs">
              <span className="font-mono text-chart-5 w-20 flex-shrink-0">{c.no}</span>
              <span className="text-white/70 flex-1">{c.desc}</span>
              <span className="font-mono text-white/50">{formatMoney(c.value, { currency: ccy })}</span>
              <span className="font-mono text-primary/70 w-16 text-right flex-shrink-0">+{c.time}d</span>
              <span className={cn('text-(length:--t-second) w-20 text-right', getClaimStatusStyle(c.status))}>{c.status}</span>
              {canEdit && (
                <button
                  onClick={() => onUnlinkCo(delayRow.id, c.no)}
                  className="text-white/20 hover:text-chart-3 transition-colors ml-1 flex-shrink-0"
                  title="Remove link"
                  aria-label="Remove link"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Combined impact summary */}
      {(linkedClaims.length > 0 || linkedCOs.length > 0) && (
        <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground">Total Claimed</div>
            <div className="text-xs font-mono text-chart-3">{formatMoney(linkedClaims.reduce((a, c) => a + c.claimed, 0), { currency: ccy })}</div>
          </div>
          <div>
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground">Settled</div>
            <div className="text-xs font-mono text-chart-4">{formatMoney(linkedClaims.reduce((a, c) => a + c.settled, 0), { currency: ccy })}</div>
          </div>
          <div>
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground">CO Value</div>
            <div className="text-xs font-mono text-chart-5">{formatMoney(linkedCOs.reduce((a, c) => a + c.value, 0), { currency: ccy })}</div>
          </div>
          <div>
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground">EOT Requested</div>
            <div className="text-xs font-mono text-primary">{totalEotRequested} days</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────

export default function DelayModule({ project, canEdit = true }: { project: Project; canEdit?: boolean }) {
  // SPRINT 3 · R5 — the currency this screen's figures are expressed in.
  // Without it every formatMoney(, { currency: ccy }) below fell through to the 'SAR' default.
  // PROJECT SCREENS ARE DENOMINATED IN THE CONTRACT CURRENCY.
  // `.reporting` is the AGGREGATION currency, used when this project is
  // rolled up into a company or portfolio figure. Reading it here is what
  // printed the company's unit on a project's own numbers.
  const ccy = useProjectCurrency(project).base;
  const { t, lang } = useTranslation();
  const { updateProject } = useProjects();
  const { user } = useAuth();
  const [data, setData] = useState<DelayRow[]>([]);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [cos, setCos] = useState<CORow[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [expandedLinks, setExpandedLinks] = useState<string | null>(null);
  const [newRow, setNewRow] = useState({
    id: '', description: '', responsibleParty: 'contractor', startDate: '', endDate: '',
    delayDays: '', eotDays: '', costImpact: '', category: 'design', status: 'identified', notes: '',
  });

  // ── LD state ──
  const [ldLog, setLdLog] = useState<LdLogEntry[]>([]);
  const [showLdHistory, setShowLdHistory] = useState(false);
  const lastSignature = useRef<string | null>(null);

  // ── Windows Analysis ──
  const [windows, setWindows] = useState<DelayWindow[]>([]);
  const [selectedWindow, setSelectedWindow] = useState<string | null>(null);
  const [showWindows, setShowWindows] = useState(false);

  const isRtl = lang === 'ar';

  useEffect(() => {
    // PHASE 3G — the Delay Register no longer writes a seed row on first
    // open. It is DERIVED anyway: `syncDelayRegister` builds it from the
    // two authoritative sources below, so an empty project correctly
    // yields an empty register rather than an invented delay event.
    
    // The Delay Register is built and refreshed from the two authoritative
    // schedule-impacting sources: Time Claims and Change Orders that carry a
    // time extension. Purely financial COs are ignored. Events present as
    // both a Claim and a CO update one row rather than duplicating.
    setData(syncDelayRegister(project.id).rows);
  }, [project.id]);

  // Load claims + change orders for cross-linking
  useEffect(() => {
    const raw = localStorage.getItem(`pactum-claims-${project.id}`);
    if (raw) setClaims(JSON.parse(raw));
    const rawCo = localStorage.getItem(`pactum-co-${project.id}`);
    if (rawCo) setCos(JSON.parse(rawCo));
  }, [project.id]);

  // Re-sync when Claims / Change Orders change in another tab or module.
  useEffect(() => {
    const resync = () => setData(syncDelayRegister(project.id).rows);
    window.addEventListener('storage', resync);
    window.addEventListener('focus', resync);
    return () => {
      window.removeEventListener('storage', resync);
      window.removeEventListener('focus', resync);
    };
  }, [project.id]);

  const persist = (next: DelayRow[]) => {
    setData(next);
    localStorage.setItem(`pactum-delays-${project.id}`, JSON.stringify(next));
  };

  const updateField = (index: number, field: keyof DelayRow, value: any) => {
    persist(data.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRow.id) return;
    const row: DelayRow = {
      id: newRow.id, description: newRow.description, responsibleParty: newRow.responsibleParty,
      startDate: newRow.startDate, endDate: newRow.endDate,
      delayDays: Number(newRow.delayDays) || 0, eotDays: Number(newRow.eotDays) || 0,
      costImpact: Number(newRow.costImpact) || 0, category: newRow.category,
      status: newRow.status, notes: newRow.notes, linkedClaimNos: [],
    };
    persist([...data, row]);
    setNewRow({ id: '', description: '', responsibleParty: 'contractor', startDate: '', endDate: '', delayDays: '', eotDays: '', costImpact: '', category: 'design', status: 'identified', notes: '' });
    setIsAdding(false);
  };

  const handleDelete = (index: number) => persist(data.filter((_, i) => i !== index));

  // Cross-linking handlers
  const handleLinkClaim = (delayId: string, claimNo: string) => {
    persist(data.map(row => {
      if (row.id !== delayId) return row;
      const existing = row.linkedClaimNos || [];
      if (existing.includes(claimNo)) return row;
      return { ...row, linkedClaimNos: [...existing, claimNo] };
    }));
  };

  const handleUnlinkClaim = (delayId: string, claimNo: string) => {
    persist(data.map(row => {
      if (row.id !== delayId) return row;
      return { ...row, linkedClaimNos: (row.linkedClaimNos || []).filter(no => no !== claimNo) };
    }));
  };

  // Change-order links. Same shape as the claim handlers so one delay event
  // can carry both kinds of evidence without ever being duplicated.
  const handleLinkCo = (delayId: string, coNo: string) => {
    persist(data.map(row => {
      if (row.id !== delayId) return row;
      const existing = ((row as any).linkedCoNos as string[] | undefined) || [];
      if (existing.includes(coNo)) return row;
      return { ...row, linkedCoNos: [...existing, coNo] } as DelayRow;
    }));
  };

  const handleUnlinkCo = (delayId: string, coNo: string) => {
    persist(data.map(row => {
      if (row.id !== delayId) return row;
      const existing = ((row as any).linkedCoNos as string[] | undefined) || [];
      return { ...row, linkedCoNos: existing.filter(no => no !== coNo) } as DelayRow;
    }));
  };

  // ── LD computation ──
  // Shares lib/ldCalc.ts with OverviewModule so the two can never drift.
  // EOT = approved CO.time + approved Claim.timeDays. DelayRow.eotDays is
  // evidence only and is deliberately NOT a second source of approved time.
  const ld = useMemo(
    () => computeLd(project, computeApprovedEOT(project.id)),
    // `claims` and `data` are dependencies because editing either can change
    // an approval status, which changes the EOT total.
    [project, project.id, project.delayDays, project.ldRatePerDay, project.ldCapAmount, claims, data],
  );

  useEffect(() => {
    const rows = readLdLog(project.id);
    setLdLog(rows);
    // Seed the guard from the LAST PERSISTED ROW, not from null.
    //
    // The ref only lives as long as the component is mounted, so leaving the
    // tab and coming back used to forget what was already on record. Seeding
    // from storage means the comparison survives a remount and the log stays
    // a record of real changes rather than of navigation.
    const last = rows.length ? rows[rows.length - 1] : null;
    lastSignature.current = last
      ? [last.totalDelay, last.approvedExtension, last.culpableDelay,
         project.ldRatePerDay ?? 0, project.ldCapAmount ?? 0, last.ldExposure].join('|')
      : null;
  }, [project.id]);

  // Append-only log. Writes when rate, cap, delayDays or the resulting
  // exposure actually changes — never on a plain re-render or a tab switch.
  useEffect(() => {
    const sig = ldSignature(ld);
    if (lastSignature.current === null) { lastSignature.current = sig; return; }
    if (lastSignature.current === sig) return;
    lastSignature.current = sig;
    setLdLog(appendLdLog(project.id, buildLogEntry(ld, undefined, user?.username)));
  }, [ld, project.id, user?.username]);

  const patchProject = (field: 'ldRatePerDay' | 'ldCapAmount' | 'delayDays' | 'plannedDurationDays', value: any) => {
    updateProject({ ...project, [field]: Number(value) || 0 });
  };

  /** Programme dates are stored as text, never coerced to a number. */
  const patchProjectDate = (field: 'commencementDate' | 'contractualCompletion' | 'approvedCompletion', value: string) => {
    updateProject({ ...project, [field]: value });
  };

  // Summary stats
  // NOTE: these two are REGISTER sums (Σ over the delay-event rows below).
  // They are NOT the authoritative project figures. The headline "Total Delay"
  // tile and the whole LD section read project.delayDays via ld.* instead, so
  // the two tiles can never disagree. These remain the inputs to the Schedule
  // Impact bars, which are about the delay-event register specifically.
  const totalDelay     = data.reduce((a, b) => a + (b.delayDays || 0), 0);
  /**
   * SPRINT 3 · R6 — ONE SOURCE FOR APPROVED EOT.
   *
   * THE DEFECT, MEASURED
   *
   *   Three implementations of one rule existed:
   *
   *     1. delayCalculations.ts computeApprovedEOT()   <- canonical
   *          Sigma approved CO.time + Sigma approved Claim.timeDays
   *     2. this line, previously:
   *          data.filter(approved).reduce(+ eotDays)
   *     3. EVMModule.tsx approvedExtensions()
   *          a hand-rolled copy of #1 reading storage directly
   *
   *   #2 summed `DelayRow.eotDays` — the very field the architecture
   *   EXCLUDES. A DelayRow linked to a Claim already has that Claim's
   *   time counted through the Claim, so adding the row's own eotDays
   *   counts the same grant twice.
   *
   *   Measured on a real project: the Delay screen showed 140d while the
   *   Earned Value screen showed 95d, for the same project at the same
   *   moment. 140 = 65 (COs) + 30 (Claims) + 45 (raw event rows). The
   *   45 is the double count. Approved Finish is derived from this, so
   *   the contractual date was out by 45 DAYS.
   *
   * THE FIX
   *
   *   `ld.totalApprovedEOT` was ALREADY computed in this component (see
   *   the computeLd call above) and simply not used by the tile. Reading
   *   it removes implementation #2 entirely — no new logic, one less
   *   copy of the rule.
   */
  const totalEOT       = ld.totalApprovedEOT;
  // Gross delay cost. Shared with the Net Cost Impact tile via
  // lib/delayCalculations.ts so the two figures can never diverge.
  // Value is unchanged: same Sigma costImpact over every register row.
  const totalCostImpact = sumCostImpact(data);
  const unresolved     = data.filter(d => d.status !== 'approved' && d.status !== 'rejected').length;
  // Number of delay events on record. The tile is hidden entirely when the
  // register is empty rather than showing a bare "0".
  const delayEventCount = data.length;
  /**
   * Unmitigated = Total Delay − Approved EOT.
   *
   * Both terms come from the LD engine, NOT from summing the register:
   *   totalDelay        = project.delayDays, the authoritative manual figure
   *   totalApprovedEOT  = Sigma approved CO time + approved Claim time
   *
   * The old code subtracted approved EOT from Sigma DelayRow.delayDays, which
   * mixed two different bases — the tile showed a manual 25d for Total Delay
   * while computing Unmitigated from a 48d register sum, giving 34d instead
   * of 11d. Reading both terms from one source removes that contradiction.
   */
  //
  // SPRINT 1 · TASK 3 — NEGATIVE VALUES MUST NEVER APPEAR.
  //
  // The subtraction above was performed inline and UNFLOORED. When the
  // approved extension exceeds the recorded delay — the normal case for a
  // project running to programme with approved COs — it produced a
  // negative:
  //
  //   totalDelay 0 − totalApprovedEOT 140 = −140
  //
  // and the UI printed "Unmitigated: -140d" and "−140d approved EOT".
  // Negative unmitigated delay has no engineering meaning: a project
  // cannot be behind by a negative number of days. Surplus entitlement is
  // simply zero exposure.
  //
  // `computeCulpableDelay` in lib/delayCalculations.ts already applies the
  // floor — the platform rule is Math.max(0, totalDelay − approvedEOT) —
  // but this line never called it and re-implemented the arithmetic
  // instead. `ld.culpableDelay` IS that floored figure, computed by
  // computeLd from the very same two terms.
  //
  // Reading it here removes the second implementation entirely: one rule,
  // one place. The three local Math.max(0, …) patches that used to guard
  // individual call sites are now redundant and have been removed, so a
  // future call site cannot forget one.
  const unmitigated    = ld.culpableDelay;

  // ── Programme ──
  // Commencement Date is day zero. Baseline and Approved Finish are measured
  // from it. Without one, the stored completion dates are used unchanged.
  const programme = useMemo(
    () => computeProgramme(project, ld.totalApprovedEOT, ld.totalDelay),
    [project.commencementDate, project.plannedDurationDays,
     project.contractualCompletion, project.approvedCompletion,
     ld.totalApprovedEOT, ld.totalDelay],
  );

  const plannedDuration = programme.plannedDurationDays || 730;
  // `unmitigated` is already floored at 0 by the LD engine, so no local
  // Math.max is needed — keeping one would imply the value might still be
  // negative and invite the next reader to add another.
  const totalForecast   = plannedDuration + unmitigated;
  const getPct = (v: number) => `${Math.min(100, (v / Math.max(totalForecast, 1)) * 100).toFixed(1)}%`;

  // ── Windows Analysis ──
  //
  // One snapshot per month from the project's first recorded activity to
  // today. Each window is cut off at its own month end, so a window shows the
  // position AS AT that date rather than today's figures repeated.

  /** Earliest dated activity across delays, claims and change orders. */
  const projectStartId = useMemo(() => {
    const dates: string[] = [];
    // Commencement Date is day zero of the programme, so the window timeline
    // starts there when one is on record.
    if (project.commencementDate) dates.push(project.commencementDate);
    data.forEach(d => { if (d.startDate) dates.push(d.startDate); });
    claims.forEach((c: any) => { if (c?.date) dates.push(c.date); });
    try {
      const cos = JSON.parse(localStorage.getItem(`pactum-co-${project.id}`) || '[]');
      if (Array.isArray(cos)) cos.forEach((c: any) => { if (c?.date) dates.push(c.date); });
    } catch { /* ignore */ }

    const ids = dates
      .map(d => parseAnyDate(d))
      .filter(Boolean)
      .map(p => `${p!.y}-${String(p!.m).padStart(2, '0')}`)
      .sort();

    return ids[0] || windowIdFor();
  }, [data, claims, project.id, project.commencementDate]);

  /**
   * The delay register frozen at a cut-off date. A project window reports on
   * DELAY EVENTS — subcontract history is kept in each subcontractor's own
   * window store, not here.
   */
  const buildEvents = (closesOn: string): WindowDelayEvent[] => {
    const upTo = (d?: string) => {
      if (!d) return true;
      const p = parseAnyDate(d);
      if (!p) return true;
      return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` <= closesOn;
    };
    return data
      .filter(r => upTo(r.startDate))
      .map(r => ({
        id: String(r.id),
        delayId: String((r as any).delayId ?? r.id ?? ''),
        description: String(r.description || ''),
        responsibleParty: String(r.responsibleParty || ''),
        category: String(r.category || ''),
        status: String(r.status || ''),
        startDate: String(r.startDate || ''),
        endDate: String(r.endDate || ''),
        delayDays: Number(r.delayDays) || 0,
        eotDays: Number(r.eotDays) || 0,
        costImpact: Number(r.costImpact) || 0,
      }));
  };

  /** Project position as at a cut-off date. */
  const buildProjectSnapshot = (closesOn: string): ProjectSnapshot => {
    const upTo = (d?: string) => {
      if (!d) return true;
      const p = parseAnyDate(d);
      if (!p) return true;
      return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` <= closesOn;
    };
    const rows = data.filter(r => upTo(r.startDate));
    // Same basis as the header tiles: the floored culpable delay from the
    // LD engine. Summing the register here would reintroduce the very
    // mismatch this snapshot is meant to record faithfully.
    //
    // SPRINT 1 · TASK 3 — this site mattered most. A window snapshot is
    // ARCHIVED: once its month closes it is never rebuilt. The unfloored
    // subtraction here wrote −140 into a permanent historical record, where
    // it would have been reproduced by every later report of that period.
    // Reading ld.culpableDelay means the floor is applied BEFORE the figure
    // is filed, not after it is read back.
    const unmit = ld.culpableDelay;
    return {
      plannedFinish: programme.baselineFinish || project.contractualCompletion || '',
      forecastFinish: programme.forecastFinish || project.approvedCompletion || '',
      approvedFinish: programme.approvedFinish || project.approvedCompletion || '',
      currentVariance: unmit,
      totalDelay: ld.totalDelay,
      approvedEot: ld.totalApprovedEOT,
      unmitigatedDelay: unmit,
      recoveryRequired: unmit,
      ldExposure: ld.ldExposure,
      // APPROVED rows only, so this figure and the Approved Total in the
      // table footer below are the same number. An unapproved row carries no
      // authorised cost, and Net Cost Impact is derived from this value.
      // sumCostImpact() itself is untouched — the main Net Cost tile and the
      // subcontract engine still call it over the full register.
      costImpact: sumCostImpact(rows.filter(r => r.status === 'approved')),
      delayEventCount: rows.length,
    };
  };

  useEffect(() => { setWindows(readWindows(project.id)); }, [project.id]);

  // Backfill every month from project start to today. Closed months are never
  // rebuilt; only the current month tracks live edits.
  useEffect(() => {
    const res = backfillWindows(project.id, projectStartId, (closesOn) => ({
      project: buildProjectSnapshot(closesOn),
      events: buildEvents(closesOn),
    }));
    if (res.created || res.updated) setWindows(res.windows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, projectStartId, data, claims, ld, programme]);

  // Net delay cost after liquidated damages. Negative => LD outweighs the
  // delay cost recorded in the register.
  const netCostImpact = computeNetCostImpact(totalCostImpact, ld.ldExposure);

  return (
    <div className="pg-stack ds-page">

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="ds-card ds-card-raised bg-black/30 p-5 border-t-chart-5 border-t-2">
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-4 h-4 text-chart-5" />
            <span className="text-(length:--t-label) uppercase text-muted-foreground">Total Delay</span>
          </div>
          {/* Read-only mirror. project.delayDays is edited in the Liquidated
              Damages section below — one input, one source. */}
          <div className="text-2xl font-mono text-white number-ltr">{ld.totalDelay} <span className="text-xs text-muted-foreground">days</span></div>
          <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
            {isRtl ? 'يُعدَّل من قسم الغرامات' : 'edit in Liquidated Damages'}
          </div>
        </div>
        <div className="ds-card ds-card-raised bg-black/30 p-5 border-t-primary border-t-2">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-4 h-4 text-primary" />
            <span className="text-(length:--t-label) uppercase text-muted-foreground">EOT Approved</span>
          </div>
          <div className="text-2xl font-mono text-primary number-ltr">{totalEOT} <span className="text-xs text-muted-foreground">days</span></div>
        </div>
        <div className="ds-card ds-card-raised bg-black/30 p-5 border-t-chart-3 border-t-2">
          <div className="flex items-center justify-between mb-2">
            <DollarSign className="w-4 h-4 text-chart-3" />
            <span className="text-(length:--t-label) uppercase text-muted-foreground">Cost Impact</span>
          </div>
          <div className="text-lg font-mono text-chart-3 number-ltr">{formatMoney(totalCostImpact, { currency: ccy })}</div>
        </div>
        {delayEventCount > 0 && (
          <div className="ds-card ds-card-raised bg-black/30 p-5 border-t-chart-5 border-t-2">
            <div className="flex items-center justify-between mb-2">
              <AlertTriangle className="w-4 h-4 text-chart-5" />
              <span className="text-(length:--t-label) uppercase text-muted-foreground">
                {isRtl ? 'أحداث التأخير' : 'Delay Events'}
              </span>
            </div>
            <div className="text-2xl font-mono text-white number-ltr">
              {delayEventCount}
              {unresolved > 0 && (
                <span className="text-xs text-chart-5 ms-2">
                  {unresolved} {isRtl ? 'قيد المعالجة' : 'unresolved'}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Schedule Impact */}
      <div className="ds-card ds-card-raised">
        <h3 className="text-sm font-serif uppercase tracking-widest text-primary mb-6">Schedule Impact Analysis</h3>
        <div className="space-y-5">
          {[
            { label: 'Planned Duration', val: plannedDuration, barClass: 'bg-chart-2' },
            { label: 'Current Forecast (incl. unmitigated delay)', val: totalForecast, barClass: 'bg-chart-5/60' },
          ].map((item, i) => (
            <div key={i}>
              <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                <span className="uppercase tracking-widest">{item.label}</span>
                <span className="font-mono">{item.val} days</span>
              </div>
              <div className="h-3 bg-white/5 rounded-sm overflow-hidden">
                <div className={cn('h-full transition-all', item.barClass)} style={{ width: getPct(item.val) }} />
              </div>
            </div>
          ))}
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <span className="uppercase tracking-widest">EOT Recovery</span>
              <span className="font-mono text-primary">Approved: {totalEOT}d | Unmitigated: {unmitigated}d</span>
            </div>
            <div className="h-3 bg-white/5 rounded-sm overflow-hidden flex">
              <div className="h-full bg-primary/30" style={{ width: getPct(plannedDuration) }} />
              <div className="h-full bg-primary border-l border-black" style={{ width: getPct(totalEOT) }} />
              {unmitigated > 0 && <div className="h-full bg-chart-3 border-l border-black" style={{ width: getPct(unmitigated) }} />}
            </div>
          </div>
        </div>
        {/* Programme dates.
            Commencement Date is day zero: Baseline Finish = Commencement +
            Planned Duration, Approved Finish = Baseline + Approved EOT. Both
            become read-only derived figures once a commencement date and a
            duration are on record. */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 pt-4 border-t border-white/5">

          <div className="bg-black/40 p-3 text-center border border-primary/20">
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1 flex items-center justify-center gap-1">
              <CalendarClock className="w-3 h-3 text-primary/60" />
              {isRtl ? 'تاريخ المباشرة' : 'Commencement Date'}
            </div>
            <div className="text-sm font-mono number-ltr text-primary">
              <EditableDate
                value={project.commencementDate || ''}
                onSave={v => patchProjectDate('commencementDate', v)}
                canEdit={canEdit}
                placeholder={isRtl ? 'حدّد التاريخ' : 'Set date'}
              />
            </div>
          </div>

          <div className="bg-black/40 p-3 text-center">
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">
              {isRtl ? 'المدة التعاقدية (يوم)' : 'Planned Duration (days)'}
            </div>
            <div className="text-sm font-mono number-ltr text-white">
              <EditableNumber
                value={programme.plannedDurationDays}
                onSave={v => patchProject('plannedDurationDays', v)}
                canEdit={canEdit}
                display={`${programme.plannedDurationDays}`}
              />
            </div>
          </div>

          <div className="bg-black/40 p-3 text-center">
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">
              {isRtl ? 'الانتهاء الأساسي' : 'Baseline Finish'}
            </div>
            <div className="text-sm font-mono number-ltr text-muted-foreground">
              {programme.derived
                ? formatDateOrDash(programme.baselineFinish, isRtl ? 'ar' : 'en')
                : (
                  <EditableDate
                    value={project.contractualCompletion || ''}
                    onSave={v => patchProjectDate('contractualCompletion', v)}
                    canEdit={canEdit}
                    placeholder={isRtl ? 'حدّد التاريخ' : 'Set date'}
                  />
                )}
            </div>
            {programme.derived && (
              <div className="text-(length:--t-label) uppercase tracking-wider text-primary/75 mt-1">
                {isRtl ? 'محسوب' : 'Derived'}
              </div>
            )}
          </div>

          <div className="bg-black/40 p-3 text-center">
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">
              {isRtl ? 'الانتهاء المعتمد' : 'Approved Finish'}
            </div>
            <div className="text-sm font-mono number-ltr text-primary">
              {formatDateOrDash(programme.approvedFinish, isRtl ? 'ar' : 'en')}
            </div>
            <div className="text-(length:--t-label) uppercase tracking-wider text-primary/75 mt-1">
              {isRtl ? `أساسي + ${ld.totalApprovedEOT} يوم` : `Baseline + ${ld.totalApprovedEOT}d EOT`}
            </div>
          </div>

          {/* Estimated Finish = Approved Finish + Total Delay. */}
          <div className="bg-black/40 p-3 text-center">
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">
              {isRtl ? 'الانتهاء المتوقع' : 'Estimated Finish'}
            </div>
            <div className="text-sm font-mono number-ltr text-chart-5">
              {formatDateOrDash(programme.estimatedFinish, isRtl ? 'ar' : 'en')}
            </div>
            <div className="text-(length:--t-label) uppercase tracking-wider text-white/45 mt-1">
              {isRtl ? `المعتمد + ${ld.totalDelay} يوم` : `Approved + ${ld.totalDelay}d delay`}
            </div>
          </div>

          <div className="bg-black/40 p-3 text-center">
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">
              {isRtl ? 'الفرق الحالي' : 'Current Variance'}
            </div>
            <div className={cn('text-sm font-mono number-ltr', unmitigated > 0 ? 'text-chart-3' : 'text-chart-4')}>
              {unmitigated > 0 ? '-' : ''}{unmitigated} {isRtl ? 'يوم' : 'days'}
            </div>
          </div>

          <div className="bg-black/40 p-3 text-center">
            <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">
              {isRtl ? 'التعويض المطلوب' : 'Recovery Required'}
            </div>
            <div className={cn('text-sm font-mono number-ltr', unmitigated > 0 ? 'text-chart-5' : 'text-chart-4')}>
              {unmitigated} {isRtl ? 'يوم' : 'days'}
            </div>
          </div>
        </div>

        {!programme.commencementDate && (
          <p className="text-(length:--t-second) text-white/45 italic mt-3">
            {isRtl
              ? 'أدخل تاريخ المباشرة والمدة التعاقدية ليُحسب الانتهاء الأساسي والمعتمد تلقائياً.'
              : 'Enter a Commencement Date and Planned Duration to derive Baseline and Approved Finish automatically.'}
          </p>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          LIQUIDATED DAMAGES
          Contractual exposure — driven by project.delayDays (manual,
          authoritative) minus approved EOT from COs and Claims.
          ══════════════════════════════════════════════════════════════ */}
      <div className="ds-card ds-card-raised">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
          <h3 className="text-sm font-serif uppercase tracking-widest text-primary flex items-center gap-2">
            <Scale className="w-4 h-4" />
            {isRtl ? 'غرامات التأخير' : 'Liquidated Damages'}
          </h3>
          <div className="flex items-center gap-2">
            {ld.capReached && (
              <span className="flex items-center gap-1.5 text-(length:--t-micro) uppercase tracking-wider px-2.5 py-1 border border-chart-3/40 text-chart-3 bg-chart-3/10 rounded-full">
                <AlertTriangle className="w-3 h-3" />
                {isRtl ? 'تم بلوغ الحد الأقصى' : 'Cap Reached'}
              </span>
            )}
            {ld.uncapped && (
              <span className="flex items-center gap-1.5 text-(length:--t-micro) uppercase tracking-wider px-2.5 py-1 border border-chart-5/40 text-chart-5 bg-chart-5/10 rounded-full">
                <AlertTriangle className="w-3 h-3" />
                {isRtl ? 'بدون حد أقصى' : 'No Cap Set'}
              </span>
            )}
          </div>
        </div>

        {/* Delay chain — Total Delay is the ONE manual input: it is the
            contractor's actual delay on site. Everything after it is derived. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5 mb-px">

          <div className="bg-black/40 p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-(length:--t-label) font-medium uppercase text-muted-foreground">
                {isRtl ? 'إجمالي التأخير' : 'Total Delay'}
              </span>
              {canEdit && (
                <span className="text-(length:--t-label) text-muted-foreground uppercase tracking-widest">
                  {isRtl ? 'قابل للتعديل' : 'Editable'}
                </span>
              )}
            </div>
            <div className="text-2xl font-mono number-ltr font-semibold text-white">
              <EditableNumber
                value={ld.totalDelay}
                onSave={v => patchProject('delayDays', v)}
                canEdit={canEdit}
                display={`${ld.totalDelay}`}
                className="text-2xl font-mono number-ltr font-semibold text-white"
              />
              <span className="text-xs font-sans text-muted-foreground ms-1">
                {isRtl ? 'يوم' : 'days'}
              </span>
            </div>
            <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
              {isRtl ? 'التأخير الفعلي بالموقع — إدخال يدوي' : 'Actual site delay — manual entry'}
            </div>
          </div>

          {[
            {
              label: isRtl ? 'التمديد المعتمد' : 'Approved Extension',
              val: `${ld.totalApprovedEOT}`,
              unit: isRtl ? 'يوم' : 'days',
              c: 'text-primary',
              hint: `CO ${ld.coEOT}d + ${isRtl ? 'مطالبات' : 'Claims'} ${ld.claimEOT}d`,
            },
            {
              label: isRtl ? 'التأخير الموجب للغرامة' : 'Culpable Delay',
              val: `${ld.culpableDelay}`,
              unit: isRtl ? 'يوم' : 'days',
              c: ld.culpableDelay > 0 ? 'text-chart-3' : 'text-chart-4',
              hint: isRtl ? 'الإجمالي − التمديد' : 'Total − Approved',
            },
          ].map((k, i) => (
            <div key={i} className="bg-black/40 p-4">
              <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{k.label}</div>
              <div className={cn('text-2xl font-mono number-ltr font-semibold', k.c)}>
                {k.val} <span className="text-xs font-sans text-muted-foreground">{k.unit}</span>
              </div>
              <div className="text-(length:--t-data) text-white/45 font-mono mt-1">{k.hint}</div>
            </div>
          ))}
        </div>

        {/* Editable rate / cap + computed exposure + net cost impact */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-px bg-white/5">
          <div className="bg-black/40 p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-(length:--t-label) font-medium uppercase text-muted-foreground">
                {isRtl ? 'قيمة الغرامة اليومية' : 'LD Rate / Day'}
              </span>
              {canEdit && (
                <span className="text-(length:--t-label) text-muted-foreground uppercase tracking-widest">
                  {isRtl ? 'قابل للتعديل' : 'Editable'}
                </span>
              )}
            </div>
            <div className="text-lg font-mono text-white number-ltr">
              <EditableNumber
                value={project.ldRatePerDay ?? 0}
                onSave={v => patchProject('ldRatePerDay', v)}
                canEdit={canEdit}
                display={formatMoney(project.ldRatePerDay ?? 0, { currency: ld.ldCurrency })}
                className="font-mono text-lg text-white number-ltr"
              />
            </div>
          </div>

          <div className="bg-black/40 p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-(length:--t-label) font-medium uppercase text-muted-foreground">
                {isRtl ? 'الحد الأقصى للغرامة' : 'LD Cap Amount'}
              </span>
              {canEdit && (
                <span className="text-(length:--t-label) text-muted-foreground uppercase tracking-widest">
                  {isRtl ? 'قابل للتعديل' : 'Editable'}
                </span>
              )}
            </div>
            <div className="text-lg font-mono text-white number-ltr">
              <EditableNumber
                value={project.ldCapAmount ?? 0}
                onSave={v => patchProject('ldCapAmount', v)}
                canEdit={canEdit}
                display={(project.ldCapAmount ?? 0) > 0 ? formatMoney(project.ldCapAmount ?? 0, { currency: ld.ldCurrency }) : '—'}
                className="font-mono text-lg text-white number-ltr"
              />
            </div>
            <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
              {isRtl ? 'مبلغ مطلق حسب بند العقد' : 'Absolute amount per contract clause'}
            </div>
          </div>

          <div className={cn('p-4', ld.capReached ? 'bg-chart-3/[0.07]' : 'bg-black/40')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-(length:--t-label) font-medium uppercase text-muted-foreground">
                {isRtl ? 'الغرامة المستحقة' : 'LD Exposure'}
              </span>
              <span className="flex items-center gap-1 text-(length:--t-label) uppercase tracking-wider text-emerald-400/70">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 inline-block" />
                {isRtl ? 'تلقائي' : 'Auto'}
              </span>
            </div>
            <div className={cn(
              'text-lg font-mono number-ltr font-semibold',
              ld.capReached ? 'text-chart-3' : ld.ldExposure > 0 ? 'text-chart-5' : 'text-muted-foreground',
            )}>
              {formatMoney(ld.ldExposure, { currency: ld.ldCurrency })}
            </div>
            <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
              {ld.culpableDelay} × {formatMoney(ld.ldRatePerDay, { currency: ld.ldCurrency })}
              {ld.cappedAmount > 0 && (
                <span className="text-chart-3/70">
                  {' '}· {isRtl ? 'مستبعد' : 'capped'} {formatMoney(ld.cappedAmount, { currency: ld.ldCurrency })}
                </span>
              )}
            </div>
          </div>

          {/* Net Cost Impact — gross delay cost netted against LD.
              Gross figure is the SAME sum as the top "Cost Impact" tile,
              via sumCostImpact() in lib/delayCalculations.ts. */}
          <div className={cn('p-4', netCostImpact < 0 ? 'bg-chart-3/[0.07]' : 'bg-black/40')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-(length:--t-label) font-medium uppercase text-muted-foreground">
                {isRtl ? 'صافي التكلفة (بعد الغرامة)' : 'Net Cost Impact (after LD)'}
              </span>
              <span className="flex items-center gap-1 text-(length:--t-label) uppercase tracking-wider text-emerald-400/70">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 inline-block" />
                {isRtl ? 'تلقائي' : 'Auto'}
              </span>
            </div>
            <div className={cn(
              'text-lg font-mono number-ltr font-semibold',
              netCostImpact < 0 ? 'text-chart-3' : 'text-white',
            )}>
              {formatMoney(netCostImpact, { currency: ccy })}
            </div>
            <div className="text-(length:--t-data) text-white/45 font-mono mt-1">
              {isRtl
                ? 'إجمالي تكلفة التأخير − الغرامة'
                : 'Gross Delay Cost − LD Exposure'}
              {' '}({formatMoney(totalCostImpact, { currency: ccy })})
            </div>
            {netCostImpact < 0 && (
              <div className="text-(length:--t-second) text-chart-3 mt-1">
                {isRtl
                  ? 'الغرامة تتجاوز تكلفة التأخير المسجّلة'
                  : 'LD exceeds recorded delay cost'}
              </div>
            )}
          </div>
        </div>

        {/* Cap utilisation */}
        {ld.ldCapAmount > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <span className="uppercase tracking-widest">{isRtl ? 'استهلاك الحد الأقصى' : 'Cap Utilisation'}</span>
              <span className="font-mono">
                {formatMoney(ld.ldExposure, { currency: ld.ldCurrency })} / {formatMoney(ld.ldCapAmount, { currency: ld.ldCurrency })}
                {' '}({Math.min(100, (ld.ldExposure / ld.ldCapAmount) * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="h-3 bg-white/5 rounded-sm overflow-hidden">
              <div
                className={cn('h-full transition-all', ld.capReached ? 'bg-chart-3' : 'bg-chart-5/60')}
                style={{ width: `${Math.min(100, (ld.ldExposure / ld.ldCapAmount) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {ld.culpableDelay === 0 && ld.totalDelay > 0 && (
          <p className="text-(length:--t-second) text-white/25 italic mt-4">
            {isRtl
              ? 'التمديد المعتمد يغطي كامل التأخير — لا توجد غرامة مستحقة حالياً.'
              : 'Approved extension covers the full delay — no LD currently due.'}
          </p>
        )}

        {/* ── LD History — append-only ── */}
        <div className="mt-6 pt-4 border-t border-white/5">
          <button
            onClick={() => setShowLdHistory(v => !v)}
            className="flex items-center gap-2 text-(length:--t-label) uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
          >
            {showLdHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <History className="w-3.5 h-3.5" />
            {isRtl ? 'سجل الغرامات' : 'LD History'}
            <span className="text-white/30">({ldLog.length})</span>
          </button>

          {showLdHistory && (
            <div className="mt-3">
              {ldLog.length === 0 ? (
                <p className="text-(length:--t-second) text-white/20 italic">
                  {isRtl ? 'لا يوجد سجل بعد.' : 'No history yet.'}
                </p>
              ) : (
                <div className="ds-table-wrap">
                  <table className="ds-table min-w-[720px]">
                    <thead>
                      <tr>
                        <th className="text-start">{isRtl ? 'التاريخ' : 'Date'}</th>
                        <th className="text-start">{isRtl ? 'إجمالي التأخير' : 'Total Delay'}</th>
                        <th className="text-start">{isRtl ? 'التمديد المعتمد' : 'Approved Ext.'}</th>
                        <th className="text-start">{isRtl ? 'التأخير الموجب' : 'Culpable'}</th>
                        <th className="text-start">{isRtl ? 'الغرامة' : 'LD Exposure'}</th>
                        <th className="text-start">{isRtl ? 'بواسطة' : 'By'}</th>
                        <th className="text-start">{isRtl ? 'ملاحظة' : 'Note'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Newest first — the stored array is append-order. */}
                      {[...ldLog].reverse().map((e, i) => (
                        <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors">
                          <td className="font-mono text-muted-foreground number-ltr whitespace-nowrap">
                            {formatDateTime(e.date, isRtl ? 'ar' : 'en')}
                          </td>
                          <td className="money">{e.totalDelay}d</td>
                          <td className="money">{e.approvedExtension}d</td>
                          <td className="money">{e.culpableDelay}d</td>
                          <td className="money" title={exactMoney(e.ldExposure, ccy)}>{abbrevMoney(e.ldExposure)}</td>
                          <td className="text-muted-foreground">{e.updatedBy || '—'}</td>
                          <td className="text-muted-foreground">{e.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-(length:--t-second) text-white/45 italic mt-2">
                {isRtl ? 'سجل للإضافة فقط — لا يمكن تعديل أو حذف القيود السابقة.' : 'Append-only — past entries cannot be edited or deleted.'}
              </p>
            </div>
          )}
        </div>
      </div>


      {/* ══════════════════════════════════════════════════════════════
          WINDOWS ANALYSIS
          One snapshot per calendar month, created on the first change in
          that month and frozen once the month closes. Historical record —
          never a second source of live figures.
          ══════════════════════════════════════════════════════════════ */}
      {windows.length > 0 && (
        <div className="ds-card ds-card-raised">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-serif uppercase tracking-widest text-primary flex items-center gap-2">
              <LayoutGrid className="w-4 h-4" />
              {isRtl ? 'تحليل النوافذ' : 'Windows'}
              <span className="text-muted-foreground font-sans normal-case tracking-normal text-xs">
                ({windows.length})
              </span>
            </h3>
            <button
              onClick={() => setShowWindows(v => !v)}
              className="flex items-center gap-2 text-(length:--t-label) uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
            >
              {showWindows ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showWindows ? (isRtl ? 'إخفاء' : 'Hide') : (isRtl ? 'عرض' : 'Show')}
            </button>
          </div>

          {/* Timeline */}
          <div className="flex items-center gap-2 flex-wrap">
            {windows.map(w => {
              const closed = isWindowClosed(w.id);
              const active = selectedWindow === w.id;
              return (
                <button
                  key={w.id}
                  onClick={() => { setSelectedWindow(active ? null : w.id); setShowWindows(true); }}
                  className={cn(
                    'inline-flex items-center gap-2 px-3 py-2 text-xs border rounded-md transition-colors uppercase tracking-wider',
                    active
                      ? 'bg-primary/10 text-primary border-primary'
                      : 'border-white/[0.06] text-muted-foreground hover:text-white',
                  )}
                >
                  {windowLabel(w.id, isRtl ? 'ar' : 'en')}
                  <span className={cn('w-1.5 h-1.5 rounded-full',
                    closed ? 'bg-white/20' : 'bg-emerald-400/70')} />
                </button>
              );
            })}
          </div>
          <p className="text-(length:--t-data) text-white/45 font-mono mt-2">
            {isRtl
              ? 'النقطة الخضراء = الشهر الحالي (قابل للتحديث) · الرمادية = مغلق للقراءة فقط'
              : 'Green dot = current month (still updating) · grey = closed, read-only'}
          </p>

          {/* Selected snapshot */}
          {showWindows && selectedWindow && (() => {
            const idx = windows.findIndex(w => w.id === selectedWindow);
            const w = windows[idx];
            if (!w) return null;
            const delta = windowDelta(windows[idx - 1], w);
            const closed = isWindowClosed(w.id);
            const cell = (label: string, val: string, c = 'text-white', d?: number, unit = 'd') => (
              <div className="bg-black/40 p-3">
                <div className="text-(length:--t-label) font-medium uppercase text-muted-foreground mb-1">{label}</div>
                <div className={cn('text-sm font-mono number-ltr font-semibold', c)}>{val}</div>
                {d !== undefined && d !== 0 && (
                  <div className={cn('text-(length:--t-second) font-mono mt-0.5', d > 0 ? 'text-chart-3' : 'text-chart-4')}>
                    {d > 0 ? '+' : ''}{d}{unit} {isRtl ? 'عن السابق' : 'vs prev'}
                  </div>
                )}
              </div>
            );
            return (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <span className="text-xs font-serif uppercase tracking-widest text-primary">
                    {windowLabel(w.id, isRtl ? 'ar' : 'en')} — {isRtl ? 'يُغلق في' : 'closes'} {formatDate(w.closesOn, isRtl ? 'ar' : 'en')}
                  </span>
                  <span className={cn('text-(length:--t-second) uppercase tracking-wider px-2 py-1 border rounded-full',
                    closed
                      ? 'border-white/10 text-white/30'
                      : 'border-emerald-500/30 text-emerald-400/80')}>
                    {closed ? (isRtl ? 'للقراءة فقط' : 'Read-only') : (isRtl ? 'مفتوح' : 'Open')}
                  </span>
                </div>

                {/* Project position — ONE row.
                    The second row previously repeated figures already implied
                    by the first: Current Variance and Recovery Required are
                    both Unmitigated restated, and Delay Events duplicates the
                    count printed on the table heading below. Net Cost Impact
                    replaces them, because it is the only figure here a reader
                    cannot work out by looking at another tile. */}
                {(() => {
                  const netCost = computeNetCostImpact(w.project.costImpact, w.project.ldExposure);
                  return (
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-px bg-white/5">
                  {cell(isRtl ? 'الانتهاء المخطط' : 'Planned Finish', formatDateOrDash(w.project.plannedFinish, isRtl ? 'ar' : 'en'), 'text-muted-foreground')}
                  {cell(isRtl ? 'الانتهاء المتوقع' : 'Forecast Finish', formatDateOrDash(w.project.forecastFinish, isRtl ? 'ar' : 'en'), 'text-chart-5')}
                  {cell(isRtl ? 'الانتهاء المعتمد' : 'Approved Finish', formatDateOrDash(w.project.approvedFinish, isRtl ? 'ar' : 'en'), 'text-primary')}
                  {cell(isRtl ? 'إجمالي التأخير' : 'Total Delay', `${w.project.totalDelay}d`, 'text-white', delta?.totalDelay)}
                  {cell(isRtl ? 'التمديد المعتمد' : 'Approved EOT', `${w.project.approvedEot}d`, 'text-primary', delta?.approvedEot)}
                  {/* Unmitigated = Total Delay − Approved EOT. */}
                  {cell(isRtl ? 'غير المعوّض' : 'Unmitigated', `${w.project.unmitigatedDelay}d`,
                        w.project.unmitigatedDelay > 0 ? 'text-chart-3' : 'text-chart-4', delta?.unmitigatedDelay)}
                  {/* Net Cost Impact = approved cost impact − LD exposure. */}
                  {cell(isRtl ? 'صافي التكلفة بعد الغرامة' : 'Net Cost Impact (after LD)',
                        formatMoney(netCost, { currency: ccy }), netCost < 0 ? 'text-chart-3' : 'text-white')}
                </div>
                  );
                })()}

                {/* Delay events frozen in this window */}
                {(w.events || []).length > 0 ? (
                  <div className="mt-4 overflow-x-auto">
                    <p className="text-(length:--t-label) uppercase tracking-widest text-primary/60 font-mono mb-2">
                      {isRtl ? 'أحداث التأخير في هذه النافذة' : 'Delay Events In This Window'} — {(w.events || []).length}
                    </p>
                    <table className="ds-table min-w-[1000px]">
                      <thead>
                        <tr>
                          <th className="text-start">{isRtl ? 'رقم التأخير' : 'Delay ID'}</th>
                          <th className="text-start">{isRtl ? 'الوصف' : 'Description'}</th>
                          <th className="text-start">{isRtl ? 'الجهة المسؤولة' : 'Responsible'}</th>
                          <th className="text-start">{isRtl ? 'تاريخ البدء' : 'Start Date'}</th>
                          <th className="text-start">{isRtl ? 'تاريخ الانتهاء' : 'End Date'}</th>
                          <th className="text-start">{isRtl ? 'أيام التأخير' : 'Delay Days'}</th>
                          <th className="text-start">{isRtl ? 'التمديد' : 'EOT (Days)'}</th>
                          <th className="text-start">{isRtl ? 'التكلفة' : 'Cost Impact'}</th>
                          <th className="text-start">{isRtl ? 'الحالة' : 'Status'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(w.events || []).map(ev => (
                          <tr key={ev.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors">
                            <td className="font-mono text-primary">{ev.delayId || '—'}</td>
                            <td className="text-white/80">{ev.description || '—'}</td>
                            <td className="text-muted-foreground capitalize">{ev.responsibleParty || '—'}</td>
                            <td className="text-muted-foreground">{formatDateOrDash(ev.startDate, isRtl ? 'ar' : 'en')}</td>
                            <td className="text-muted-foreground">{formatDateOrDash(ev.endDate, isRtl ? 'ar' : 'en')}</td>
                            <td className="money">{ev.delayDays}d</td>
                            <td className="money">{ev.eotDays}d</td>
                            <td className="money" title={exactMoney(ev.costImpact, ccy)}>{abbrevMoney(ev.costImpact)}</td>
                            <td>
                              <span className={cn('text-(length:--t-second) uppercase tracking-wider px-2 py-0.5 border rounded-full',
                                ev.status === 'approved' ? 'border-emerald-500/30 text-emerald-400/80'
                                  : ev.status === 'rejected' ? 'border-red-500/30 text-red-400/80'
                                  : 'border-white/10 text-white/40')}>
                                {ev.status || '—'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {/* Totals count APPROVED rows only.
                          A row still under review carries no entitlement and
                          no authorised cost, so adding it to a total states a
                          commitment that does not exist. The old footer summed
                          every row's delay days and cost while filtering only
                          the EOT column — three totals on two different bases
                          in the same line. */}
                      {(() => {
                        const appr = (w.events || []).filter(e => e.status === 'approved');
                        const skipped = (w.events || []).length - appr.length;
                        return (
                      <tfoot className="border-t border-white/10 bg-black/40">
                        <tr className="text-(length:--t-label) uppercase text-muted-foreground">
                          <td colSpan={5}>
                            {isRtl ? 'الإجمالي المعتمد' : 'Approved Total'}
                            <span className="normal-case tracking-normal ms-2 text-white/45">
                              {appr.length}/{(w.events || []).length}
                              {skipped > 0 && (isRtl ? ` — ${skipped} غير معتمد` : ` — ${skipped} not approved`)}
                            </span>
                          </td>
                          <td className="money">
                            {appr.reduce((a, e) => a + (Number(e.delayDays) || 0), 0)}d
                          </td>
                          <td className="money">
                            {appr.reduce((a, e) => a + (Number(e.eotDays) || 0), 0)}d
                          </td>
                          <td className="money" title={exactMoney(appr.reduce((a, e) => a + (Number(e.costImpact) || 0), 0), ccy)}>
                            {abbrevMoney(appr.reduce((a, e) => a + (Number(e.costImpact) || 0), 0))}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                        );
                      })()}
                    </table>
                  </div>
                ) : (
                  <p className="text-(length:--t-data) text-white/45 font-mono mt-4">
                    {isRtl ? 'لا توجد أحداث تأخير مسجلة حتى نهاية هذا الشهر.' : 'No delay events on record as at the close of this month.'}
                  </p>
                )}

                <p className="text-(length:--t-second) text-white/45 italic mt-3">
                  {isRtl
                    ? 'لقطة تاريخية — تُحفظ تلقائياً ولا تُعدَّل بعد إغلاق الشهر.'
                    : 'Historical snapshot — recorded automatically, never edited once the month closes.'}
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {/* Delay Register Table */}
      <div className="ds-card ds-card-raised !p-0 overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-white/5 bg-black/40">
          <h3 className="text-sm font-serif uppercase tracking-widest text-primary">Delay Register — تحليل التأخيرات</h3>
          <ReportButton
            reportId="delay-analysis"
            context={{
              project,
              // SPRINT 4 — the report was rendering LD exposure with no
              // declared unit, so `cur()` fell through to the old SAR
              // default. The module has had the currency in scope since
              // Sprint 2B; it simply was not being handed over.
              reportCurrency: ccy,
              rows: data,
              ld,
              programme,
              windows: windows.map(w => ({
                id: w.id, label: windowLabel(w.id, lang === 'ar' ? 'ar' : 'en'),
                closesOn: w.closesOn, project: w.project, closed: isWindowClosed(w.id),
              })),
            }}
            className="ms-auto me-3"
          />
          {canEdit && (
            <button onClick={() => setIsAdding(!isAdding)} className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 text-xs hover:bg-primary hover:text-primary-foreground transition-colors uppercase tracking-wider">
              <Plus className="w-3 h-3" /> Add Delay Event
            </button>
          )}
        </div>

        {isAdding && (
          <form onSubmit={handleAdd} className="p-4 bg-black/60 border-b border-white/5 grid grid-cols-2 md:grid-cols-4 gap-3">
            <input placeholder="Delay ID (e.g. DLY-005)" value={newRow.id} onChange={e => setNewRow({ ...newRow, id: e.target.value })} className="col-span-2 bg-black border border-white/10 px-3 py-1.5 text-sm font-mono" required />
            <input placeholder="Description" value={newRow.description} onChange={e => setNewRow({ ...newRow, description: e.target.value })} className="col-span-2 bg-black border border-white/10 px-3 py-1.5 text-sm" />
            <select value={newRow.responsibleParty} onChange={e => setNewRow({ ...newRow, responsibleParty: e.target.value })} className="bg-black border border-white/10 px-3 py-1.5 text-sm text-white">
              {PARTY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={newRow.category} onChange={e => setNewRow({ ...newRow, category: e.target.value })} className="bg-black border border-white/10 px-3 py-1.5 text-sm text-white">
              {CATEGORY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input type="date" placeholder="Start Date" value={newRow.startDate} onChange={e => setNewRow({ ...newRow, startDate: e.target.value })} className="bg-black border border-white/10 px-3 py-1.5 text-sm" style={{ colorScheme: 'dark' }} />
            <input type="date" placeholder="End Date" value={newRow.endDate} onChange={e => setNewRow({ ...newRow, endDate: e.target.value })} className="bg-black border border-white/10 px-3 py-1.5 text-sm" style={{ colorScheme: 'dark' }} />
            <input type="number" placeholder="Delay Days" value={newRow.delayDays} onChange={e => setNewRow({ ...newRow, delayDays: e.target.value })} className="bg-black border border-white/10 px-3 py-1.5 text-sm font-mono" />
            <input type="number" placeholder="EOT Days" value={newRow.eotDays} onChange={e => setNewRow({ ...newRow, eotDays: e.target.value })} className="bg-black border border-white/10 px-3 py-1.5 text-sm font-mono" />
            <input type="number" placeholder="Cost Impact (SAR)" value={newRow.costImpact} onChange={e => setNewRow({ ...newRow, costImpact: e.target.value })} className="bg-black border border-white/10 px-3 py-1.5 text-sm font-mono" />
            <select value={newRow.status} onChange={e => setNewRow({ ...newRow, status: e.target.value })} className="bg-black border border-white/10 px-3 py-1.5 text-sm text-white">
              {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div className="col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={() => setIsAdding(false)} className="px-3 py-1.5 text-xs border border-white/10 text-muted-foreground hover:text-white">Cancel</button>
              <button type="submit" className="bg-primary text-primary-foreground px-4 py-1.5 text-xs uppercase tracking-wider">Add</button>
            </div>
          </form>
        )}

        <div className="ds-table-wrap">
          <table className="ds-table min-w-[1000px]">
            <thead>
              <tr>
                <th className="text-start w-8" />
                <th className="text-start">Delay ID</th>
                <th className="text-start">Description</th>
                <th className="text-start">Responsible Party</th>
                <th className="text-start">Start Date</th>
                <th className="text-start">End Date</th>
                <th className="text-start">Delay Days</th>
                <th className="text-start">EOT (Days)</th>
                <th className="text-start">Cost Impact</th>
                <th className="text-start">Category</th>
                <th className="text-start">Status</th>
                <th className="text-start">Details</th>
                {canEdit && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={13} className="px-4 py-8 text-center text-muted-foreground italic">No delay events recorded.</td></tr>
              )}
              {data.map((row, i) => {
                const linkedCount = (row.linkedClaimNos || []).length
                  + (((row as any).linkedCoNos as string[] | undefined) || []).length;
                const isExpanded  = expandedLinks === row.id;
                return (
                  <React.Fragment key={i}>
                    <tr className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                      {/* Expand toggle */}
                      <td className="text-center">
                        <button
                          onClick={() => setExpandedLinks(isExpanded ? null : row.id)}
                          className="text-muted-foreground hover:text-primary transition-colors"
                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                      <td className="font-mono text-primary font-medium">
                        <EditableText value={row.id} onSave={v => updateField(i, 'id', v)} canEdit={canEdit} />
                      </td>
                      <td className="text-white max-w-[200px]">
                        <EditableText value={row.description} onSave={v => updateField(i, 'description', v)} canEdit={canEdit} />
                      </td>
                      <td>
                        <EditableSelect value={row.responsibleParty} options={PARTY_OPTS} onSave={v => updateField(i, 'responsibleParty', v)} canEdit={canEdit} className="text-xs text-muted-foreground" />
                      </td>
                      <td className="font-mono text-muted-foreground text-xs number-ltr">
                        <EditableDate value={row.startDate} onSave={v => updateField(i, 'startDate', v)} canEdit={canEdit} />
                      </td>
                      <td className="font-mono text-muted-foreground text-xs number-ltr">
                        <EditableDate value={row.endDate} onSave={v => updateField(i, 'endDate', v)} canEdit={canEdit} />
                      </td>
                      <td className="font-mono text-chart-5 text-center number-ltr">
                        <EditableNumber value={row.delayDays} onSave={v => updateField(i, 'delayDays', v)} canEdit={canEdit} display={`${row.delayDays}`} />
                      </td>
                      <td className="font-mono text-primary text-center number-ltr">
                        <EditableNumber value={row.eotDays} onSave={v => updateField(i, 'eotDays', v)} canEdit={canEdit} display={`${row.eotDays}`} />
                      </td>
                      <td className="money">
                        <EditableNumber value={row.costImpact} onSave={v => updateField(i, 'costImpact', v)} canEdit={canEdit} display={formatMoney(row.costImpact, { currency: ccy })} />
                      </td>
                      <td className="text-xs text-muted-foreground">
                        <EditableSelect value={row.category} options={CATEGORY_OPTS} onSave={v => updateField(i, 'category', v)} canEdit={canEdit} className="text-xs" />
                      </td>
                      <td>
                        <EditableSelect value={row.status} options={STATUS_OPTS} onSave={v => updateField(i, 'status', v)} canEdit={canEdit}
                          className={cn('badge', getStatusStyle(row.status))} />
                      </td>
                      {/* Claims chip */}
                      <td>
                        <button
                          onClick={() => setExpandedLinks(isExpanded ? null : row.id)}
                          className={cn(
                            'flex items-center gap-1 text-(length:--t-second) px-2 py-1 border transition-colors uppercase tracking-wider',
                            linkedCount > 0
                              ? 'border-primary/40 text-primary bg-primary/10 hover:bg-primary/20'
                              : 'border-white/10 text-white/20 hover:border-white/20 hover:text-white/40'
                          )}
                        >
                          <Link2 className="w-3 h-3" />
                          {linkedCount}
                        </button>
                      </td>
                      {canEdit && (
                        <td>
                          <button onClick={() => handleDelete(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                    {/* Linked claims panel */}
                    {isExpanded && (
                      <tr className="border-b border-primary/10">
                        <td colSpan={canEdit ? 13 : 12} className="p-0">
                          <LinkedDetailsPanel ccy={ccy}
                            delayRow={row}
                            allClaims={claims}
                            allCOs={cos}
                            canEdit={canEdit}
                            onLink={handleLinkClaim}
                            onUnlink={handleUnlinkClaim}
                            onLinkCo={handleLinkCo}
                            onUnlinkCo={handleUnlinkCo}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
