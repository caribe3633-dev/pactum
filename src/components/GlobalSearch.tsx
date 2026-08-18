import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { Search, X, Building2, FileText, AlertTriangle, ShieldAlert, HardHat, Receipt } from 'lucide-react';
import { useTranslation } from '../lib/i18n';
import { displayName, displayCity, type Lang } from '../lib/displayName';
import { cn } from '../lib/utils';

interface SearchResult {
  id: string;
  category: string;
  title: string;
  subtitle: string;
  projectId: string;
  tab?: string;
  icon: React.ElementType;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function getAllProjects() {
  const stored = localStorage.getItem('pactum-projects');
  return stored ? JSON.parse(stored) : [];
}

/**
 * Results are built in the active language: the project name resolves
 * through `displayName`, and the category headings are localised. The
 * QUERY still matches against BOTH names, so an Arabic user can find a
 * project by typing its English name and the reverse — narrowing search
 * to one language would hide records the user knows exist.
 */
function buildResults(query: string, lang: Lang): SearchResult[] {
  const CAT = {
    projects: lang === 'ar' ? 'المشاريع' : 'Projects',
    claims: lang === 'ar' ? 'المطالبات' : 'Claims',
    changes: lang === 'ar' ? 'أوامر التغيير' : 'Change Orders',
    risks: lang === 'ar' ? 'المخاطر' : 'Risks',
    subs: lang === 'ar' ? 'مقاولو الباطن' : 'Subcontractors',
    certs: lang === 'ar' ? 'شهادات المالك' : 'Owner Certificates',
  };
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const results: SearchResult[] = [];
  const projects = getAllProjects();

  projects.forEach((p: any) => {
    const nameMatch = p.nameEn?.toLowerCase().includes(q) || p.nameAr?.toLowerCase().includes(q) || p.code?.toLowerCase().includes(q) || p.cityEn?.toLowerCase().includes(q);
    if (nameMatch) {
      results.push({ id: `proj-${p.id}`, category: CAT.projects, title: displayName(p, lang), subtitle: `${p.code} · ${displayCity(p, lang)}`, projectId: p.id, tab: 'overview', icon: Building2 });
    }

    const claims = JSON.parse(localStorage.getItem(`pactum-claims-${p.id}`) || '[]');
    claims.forEach((c: any) => {
      if (c.no?.toLowerCase().includes(q) || c.type?.toLowerCase().includes(q)) {
        results.push({ id: `claim-${p.id}-${c.no}`, category: CAT.claims, title: c.no, subtitle: `${c.type} · ${displayName(p, lang)}`, projectId: p.id, tab: 'claims', icon: FileText });
      }
    });

    const cos = JSON.parse(localStorage.getItem(`pactum-co-${p.id}`) || '[]');
    cos.forEach((c: any) => {
      if (c.no?.toLowerCase().includes(q) || c.desc?.toLowerCase().includes(q)) {
        results.push({ id: `co-${p.id}-${c.no}`, category: CAT.changes, title: c.no, subtitle: `${c.desc} · ${displayName(p, lang)}`, projectId: p.id, tab: 'changes', icon: AlertTriangle });
      }
    });

    const risks = JSON.parse(localStorage.getItem(`pactum-risk-${p.id}`) || '[]');
    risks.forEach((r: any) => {
      if (r.id?.toLowerCase().includes(q) || r.event?.toLowerCase().includes(q) || r.category?.toLowerCase().includes(q)) {
        results.push({ id: `risk-${p.id}-${r.id}`, category: CAT.risks, title: r.id, subtitle: `${r.event} · ${displayName(p, lang)}`, projectId: p.id, tab: 'risk', icon: ShieldAlert });
      }
    });

    const subs = JSON.parse(localStorage.getItem(`pactum-subs-${p.id}`) || '[]');
    subs.forEach((s: any) => {
      if (s.company?.toLowerCase().includes(q) || s.trade?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q)) {
        results.push({ id: `sub-${p.id}-${s.id}`, category: CAT.subs, title: s.company || s.name, subtitle: `${s.trade} · ${displayName(p, lang)}`, projectId: p.id, tab: 'subs', icon: HardHat });
      }
    });

    const certs = JSON.parse(localStorage.getItem(`pactum-certs-${p.id}`) || '[]');
    certs.forEach((c: any) => {
      if (c.no?.toLowerCase().includes(q) || c.period?.toLowerCase().includes(q)) {
        results.push({ id: `cert-${p.id}-${c.no}`, category: CAT.certs, title: c.no, subtitle: `${c.period} · ${displayName(p, lang)}`, projectId: p.id, tab: 'certs', icon: Receipt });
      }
    });
  });

  return results.slice(0, 20);
}

const CATEGORY_ORDER = ['Projects', 'Claims', 'Change Orders', 'Risks', 'Subcontractors', 'Owner Certificates'];

export function GlobalSearch({ open, onClose }: Props) {
  const { lang } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setResults(buildResults(query, lang as Lang));
    setSelectedIdx(0);
  }, [query, lang]);

  const navigate = (result: SearchResult) => {
    onClose();
    setLocation(`/project/${result.projectId}`);
    if (result.tab) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('pactum-navigate', { detail: { projectId: result.projectId, tab: result.tab } }));
      }, 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[selectedIdx]) { navigate(results[selectedIdx]); }
  };

  if (!open) return null;

  const grouped: Record<string, SearchResult[]> = {};
  CATEGORY_ORDER.forEach(cat => {
    const items = results.filter(r => r.category === cat);
    if (items.length) grouped[cat] = items;
  });

  let flatIdx = 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-[#0A0A0B] border border-primary/30 shadow-2xl" style={{ boxShadow: '0 0 60px rgba(212,175,90,0.1)' }}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <Search className="w-4 h-4 text-primary flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={lang === 'ar' ? 'ابحث في المشاريع والمطالبات والمخاطر ومقاولي الباطن…' : 'Search projects, claims, risks, subcontractors…'}
            className="flex-1 bg-transparent text-white placeholder-white/30 text-sm focus:outline-none font-mono"
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-white/20 border border-white/10 px-1.5 py-0.5">ESC</span>
            <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {query && results.length === 0 && (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm font-mono">
              {lang === 'ar' ? `لا نتائج لـ "${query}"` : `No results for "${query}"`}
            </div>
          )}
          {!query && (
            <div className="px-4 py-6 text-center text-muted-foreground text-xs font-mono">
              Type to search across projects, claims, risks, subcontractors, change orders, and certificates
            </div>
          )}
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <div className="px-4 py-2 text-[10px] uppercase tracking-widest text-muted-foreground bg-black/40 border-b border-white/5">
                {category}
              </div>
              {items.map(result => {
                const idx = flatIdx++;
                const Icon = result.icon;
                return (
                  <button
                    key={result.id}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 text-start border-b border-white/5 transition-colors',
                      idx === selectedIdx ? 'bg-primary/10 text-primary' : 'hover:bg-white/5 text-white/70'
                    )}
                    onClick={() => navigate(result)}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0 text-primary/60" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{result.title}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{result.subtitle}</div>
                    </div>
                    <span className="text-[10px] font-mono text-white/20 border border-white/10 px-1.5 py-0.5 flex-shrink-0">â†µ</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-white/5 flex items-center gap-4 text-[10px] text-white/20 font-mono">
            <span>â†‘â†“ navigate</span>
            <span>â†µ open</span>
            <span>esc close</span>
          </div>
        )}
      </div>
    </div>
  );
}
