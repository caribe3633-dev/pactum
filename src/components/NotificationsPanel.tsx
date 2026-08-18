import React, { useMemo } from 'react';
import { X, AlertTriangle, Clock, FileText, ShieldAlert, TrendingDown, HardHat, CheckCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatMoney } from '../lib/utils';
import { resolveProjectCurrencies } from '../lib/currencyArchitecture';
import { useTranslation } from '../lib/i18n';
import { displayName, type Lang } from '../lib/displayName';

interface Notification {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  project: string;
  time: string;
  icon: React.ElementType;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Notifications are generated text, so they are BUILT in the active
 * language rather than translated afterwards. The project name comes
 * from `displayName`, which shows the Arabic name when one was entered
 * and never invents a translation for one that was not.
 */
function buildNotifications(lang: Lang): Notification[] {
  const ar = lang === 'ar';
  const t = (en: string, arb: string) => (ar ? arb : en);
  const notifs: Notification[] = [];
  const projects = JSON.parse(localStorage.getItem('pactum-projects') || '[]');

  projects.forEach((p: any) => {
    // Late IPCs
    const certs = JSON.parse(localStorage.getItem(`pactum-certs-${p.id}`) || '[]');
    const lateCerts = certs.filter((c: any) => (c.status === 'review' || c.status === 'submitted') && !c.approvalDate);
    if (lateCerts.length > 0) {
      notifs.push({
        id: `late-ipc-${p.id}`,
        severity: 'warning',
        title: t('Late IPC Approval', 'اعتماد شهادة متأخر'),
        description: t(`${lateCerts.length} certificate(s) pending approval without a review date.`, `${lateCerts.length} شهادة بانتظار الاعتماد بلا تاريخ مراجعة.`),
        project: displayName(p, lang),
        time: '2 days ago',
        icon: Clock,
      });
    }

    // SPRINT 3 · R5 — this loop spans projects, so the currency is
    // resolved PER PROJECT rather than once for the panel. A notification
    // about a EUR project must not be labelled in another project's unit.
    const notifCcy = resolveProjectCurrencies(p.id, p.sectorId, p.companyId).reportingCurrency;

    // Open claims
    const claims = JSON.parse(localStorage.getItem(`pactum-claims-${p.id}`) || '[]');
    const openClaims = claims.filter((c: any) => c.status === 'submitted' || c.status === 'review');
    if (openClaims.length > 0) {
      notifs.push({
        id: `open-claims-${p.id}`,
        severity: 'info',
        title: t('Active Claims', 'مطالبات قائمة'),
        description: `${openClaims.length} claim(s) under review totalling ${formatMoney(openClaims.reduce((a: number, b: any) => a + (b.claimed || 0), 0), { currency: notifCcy })}.`,
        project: displayName(p, lang),
        time: '1 day ago',
        icon: FileText,
      });
    }

    // High risks
    const risks = JSON.parse(localStorage.getItem(`pactum-risk-${p.id}`) || '[]');
    const highRisks = risks.filter((r: any) => {
      const expected = (r.prob || 0) * (r.impact || 0);
      return expected > p.contractValue * 0.01;
    });
    if (highRisks.length > 0) {
      notifs.push({
        id: `high-risk-${p.id}`,
        severity: 'critical',
        title: t('Critical Risk Exposure', 'تعرّض حرج للمخاطر'),
        description: t(`${highRisks.length} high-severity risk(s) require immediate mitigation action.`, `${highRisks.length} مخاطر عالية تتطلب إجراءً فورياً.`),
        project: displayName(p, lang),
        time: '3 hours ago',
        icon: ShieldAlert,
      });
    }

    // Budget overrun
    const budget = JSON.parse(localStorage.getItem(`pactum-budget-${p.id}`) || '[]');
    const overruns = budget.filter((b: any) => b.actual > b.planned);
    if (overruns.length > 0) {
      notifs.push({
        id: `budget-overrun-${p.id}`,
        severity: 'critical',
        title: t('Budget Overrun Detected', 'تجاوز في الميزانية'),
        description: t(`${overruns.length} cost category(s) exceeding planned budget.`, `${overruns.length} بند تكلفة يتجاوز الميزانية المخططة.`),
        project: displayName(p, lang),
        time: '5 hours ago',
        icon: TrendingDown,
      });
    }

    // Subcontractor delays
    const subs = JSON.parse(localStorage.getItem(`pactum-subs-${p.id}`) || '[]');
    const delayedSubs = subs.filter((s: any) => (s.delay || s.delayDays || 0) > 0);
    if (delayedSubs.length > 0) {
      notifs.push({
        id: `sub-delay-${p.id}`,
        severity: 'warning',
        title: t('Subcontractor Delays', 'تأخر مقاولي الباطن'),
        description: t(`${delayedSubs.length} subcontractor(s) reporting schedule slippage.`, `${delayedSubs.length} مقاول باطن يبلّغ عن انزلاق زمني.`),
        project: displayName(p, lang),
        time: '1 day ago',
        icon: HardHat,
      });
    }

    // Project delay
    if (p.delayDays > 30) {
      notifs.push({
        id: `proj-delay-${p.id}`,
        severity: 'critical',
        title: t('Critical Schedule Slippage', 'انزلاق زمني حرج'),
        description: t(`Project is ${p.delayDays} days behind the contractual completion date.`, `المشروع متأخر ${p.delayDays} يوماً عن تاريخ الإنجاز التعاقدي.`),
        project: displayName(p, lang),
        time: '6 hours ago',
        icon: AlertTriangle,
      });
    } else if (p.delayDays > 0) {
      notifs.push({
        id: `proj-warn-${p.id}`,
        severity: 'warning',
        title: t('Schedule Delay', 'تأخر في الجدول'),
        description: t(`Project is ${p.delayDays} days behind schedule. EOT in progress.`, `المشروع متأخر ${p.delayDays} يوماً. طلب التمديد قيد الإجراء.`),
        project: displayName(p, lang),
        time: '1 day ago',
        icon: Clock,
      });
    }
  });

  // Sort: critical first
  const order = { critical: 0, warning: 1, info: 2 };
  return notifs.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 20);
}

const SEVERITY_STYLES = {
  critical: { bg: 'bg-chart-3/10', border: 'border-chart-3/30', text: 'text-chart-3', label: 'Critical' },
  warning:  { bg: 'bg-chart-5/10', border: 'border-chart-5/30', text: 'text-chart-5', label: 'Warning' },
  info:     { bg: 'bg-primary/10',  border: 'border-primary/30',  text: 'text-primary', label: 'Info' },
};

export function NotificationsPanel({ open, onClose }: Props) {
  const { lang } = useTranslation();
  const isRtl = lang === 'ar';
  const tr = (en: string, ar: string) => (isRtl ? ar : en);
  const notifications = useMemo(
    () => (open ? buildNotifications(lang as Lang) : []), [open, lang]);
  const criticalCount = notifications.filter(n => n.severity === 'critical').length;

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed inset-y-0 end-0 z-50 w-full max-w-sm bg-[#0A0A0B] border-s border-primary/20 flex flex-col shadow-2xl" style={{ boxShadow: '-20px 0 60px rgba(0,0,0,0.6)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 className="font-serif text-white text-lg">{tr('Notifications', 'التنبيهات')}</h2>
            {criticalCount > 0 && (
              <p className="text-[11px] text-chart-3 mt-0.5">
                {tr(`${criticalCount} critical item${criticalCount > 1 ? 's' : ''} require attention`,
                    `${criticalCount} بند حرج يتطلب انتباهاً`)}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-2">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
              <CheckCircle className="w-12 h-12 text-chart-4/40" />
              <p className="text-muted-foreground text-sm font-serif">No active notifications.</p>
              <p className="text-muted-foreground/60 text-xs">All systems operating within normal parameters.</p>
            </div>
          ) : (
            notifications.map(n => {
              const style = SEVERITY_STYLES[n.severity];
              const Icon = n.icon;
              return (
                <div key={n.id} className={cn('mx-3 my-2 p-3 border', style.bg, style.border)}>
                  <div className="flex items-start gap-3">
                    <Icon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', style.text)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-white">{n.title}</span>
                        <span className={cn('text-[9px] uppercase font-bold tracking-widest px-1.5 py-0.5 border', style.text, style.border)}>{style.label}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{n.description}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] text-primary/60 truncate">{n.project}</span>
                        <span className="text-[10px] text-white/25 font-mono flex-shrink-0">{n.time}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/5 flex-shrink-0">
          <p className="text-[10px] text-white/20 font-mono text-center">
            {notifications.length} notification{notifications.length !== 1 ? 's' : ''} آ· Derived from live project data
          </p>
        </div>
      </aside>
    </>
  );
}
