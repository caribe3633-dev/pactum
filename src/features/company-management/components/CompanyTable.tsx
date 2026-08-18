import React from 'react';
import { Company } from '../types';
import { Pencil, ImageIcon, Archive, ArchiveRestore, Trash2, Settings } from 'lucide-react';
// SPRINT 3 · R9 — derived portfolio value.
import { portfolioValues } from '../../../lib/companyPortfolio';
import { useProjects } from '../../../lib/store';

interface Props {
  companies: Company[];
  onEdit: (c: Company) => void;
  onArchive: (id: string) => void;
  /** SPRINT 2 — bring an archived company back. */
  onRestore?: (id: string) => void;
  onDelete: (id: string) => void;
  onChangeLogo: (id: string, f: File | undefined) => void;
}

export default function CompanyTable({ companies, onEdit, onArchive, onRestore, onDelete, onChangeLogo }: Props) {
  /**
   * SPRINT 3 · R9 — every company's portfolio value in one pass.
   *
   * `c.portfolioValue` is a stored 0 that nothing updates, and the cell
   * used to print a hardcoded "SAR" beside it. Both are replaced here.
   */
  const { projects } = useProjects();
  const portfolios = React.useMemo(
    () => portfolioValues(companies.map(c => c.id), projects as any),
    [companies, projects],
  );
  const portfolioOf = (id: string) =>
    portfolios[id] ?? { value: 0, currency: '', counted: 0, unconverted: 0, archived: 0, resolved: true };

  return (
    <div className="overflow-auto max-h-[60vh]">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-white/40 text-[12px] text-left border-b border-white/[0.04]">
            <th className="px-3 py-3">Logo</th>
            <th className="px-3 py-3">English Name</th>
            <th className="px-3 py-3">Arabic Name</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Portfolio Value</th>
            <th className="px-3 py-3">Sectors</th>
            <th className="px-3 py-3">Projects</th>
            <th className="px-3 py-3">Contracts</th>
            <th className="px-3 py-3">Risk Level</th>
            <th className="px-3 py-3">Compliance</th>
            <th className="px-3 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {companies.map(c => (
            <tr key={c.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
              <td className="px-3 py-3">
                <div className="w-10 h-10 bg-white/[0.03] flex items-center justify-center border border-white/[0.04]">
                  {c.logoUrl ? <img src={c.logoUrl} alt={`${c.name} logo`} className="w-9 h-9 object-contain" /> : <div className="text-white/40">{c.name.split(' ').slice(0,2).map(s=>s[0]).join('')}</div>}
                </div>
              </td>
              <td className="px-3 py-3">{c.name}</td>
              <td className="px-3 py-3">{(c as any).nameAr ?? '—'}</td>
              <td className="px-3 py-3">{c.status}</td>
              {/* SPRINT 3 · R9 — derived, and labelled with the company's
                  own reporting currency instead of a hardcoded "SAR". */}
              <td className="px-3 py-3">{portfolioOf(c.id).currency}{' '}
                {portfolioOf(c.id).value.toLocaleString()}</td>
              <td className="px-3 py-3">{c.sectors}</td>
              <td className="px-3 py-3">{c.projects}</td>
              <td className="px-3 py-3">{(c as any).contracts ?? '—'}</td>
              <td className="px-3 py-3">{c.riskRating}</td>
              <td className="px-3 py-3">{c.compliance}</td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <button title="Edit" onClick={() => onEdit(c)} className="p-1 text-white/40 hover:text-primary"><Pencil className="w-4 h-4" /></button>
                  <label title="Change logo" className="p-1 text-white/40 hover:text-primary cursor-pointer">
                    <ImageIcon className="w-4 h-4" />
                    <input type="file" accept="image/*" className="sr-only" onChange={e => onChangeLogo(c.id, e.target.files?.[0])} />
                  </label>
                  {/* SPRINT 2 — archive and restore are the same control in
                      two states. An archived row offers the way back rather
                      than only the way in. */}
                  {c.status === 'Archived'
                    ? (
                      <button
                        title="Restore"
                        onClick={() => onRestore?.(c.id)}
                        className="p-1 text-white/40 hover:text-emerald-400"
                      >
                        <ArchiveRestore className="w-4 h-4" />
                      </button>
                    )
                    : (
                      <button
                        title="Archive"
                        onClick={() => onArchive(c.id)}
                        className="p-1 text-white/40 hover:text-amber-400"
                      >
                        <Archive className="w-4 h-4" />
                      </button>
                    )}
                  <button title="Delete" onClick={() => onDelete(c.id)} className="p-1 text-white/40 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                  <button title="Settings" className="p-1 text-white/40 hover:text-primary"><Settings className="w-4 h-4" /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
