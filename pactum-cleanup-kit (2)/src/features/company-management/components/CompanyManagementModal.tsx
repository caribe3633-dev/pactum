import React, { useState } from 'react';
import { CURRENCY_SEED } from '../../../lib/currency';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
import CompanyTable from './CompanyTable';
import CompanyWizard from './CompanyWizard';
import { useCompanyManagement } from '../hooks/useCompanyManagement';
import { Company } from '../types';
import { Plus, AlertTriangle, Archive } from 'lucide-react';
// PATCH — dialog consistency. Read-only pre-flight so the dialog can pick
// its wording BEFORE the user commits. Business logic is untouched:
// deleteCompany() is not called, not changed, and remains the authority.
import { companyDependencies } from '../../../lib/companyGateway';
import { useProjects } from '../../../lib/store';
import { toLinks } from '../../../lib/projectMaster';

interface Props {
  companies?: Company[];
  onChange?: (companies: Company[]) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  // optional: when provided, the modal will open editing for this company id after open
  initialEditId?: string | null;
  // optional: when true, the modal will open the creation wizard immediately
  initialShowWizard?: boolean;
}

export default function CompanyManagementModal({ companies: initial, onChange, open: openProp, onOpenChange, hideTrigger = false, initialEditId, initialShowWizard }: Props) {
  const { companies, loading, add, update, remove, archive, restore, setCompanies } = useCompanyManagement(initial);
  const [open, setOpen] = useState(false);
  const controlledOpen = typeof openProp === 'boolean' ? openProp : open;
  const setControlledOpen = (v: boolean) => { if (onOpenChange) onOpenChange(v); else setOpen(v); };

  const [editing, setEditing] = useState<Company | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [typedName, setTypedName] = useState('');

  /** Live projects — needed to ask whether a company still has dependents. */
  const { projects } = useProjects();

  // when modal opens and an initialEditId is provided, open editor for that company
  React.useEffect(() => {
    if (!controlledOpen) return;
    if (initialEditId) {
      const target = companies.find(c => c.id === initialEditId);
      if (target) setEditing(target);
    }
    if (initialShowWizard) {
      setShowWizard(true);
    }
  }, [controlledOpen, initialEditId, initialShowWizard]);

  const handleCreate = (c: Company) => {
    const next = add(c);
    setShowWizard(false);
    if (onChange) onChange(next);
  };

  const handleUpdate = (c: Company) => {
    const next = update(c);
    setEditing(null);
    if (onChange) onChange(next);
  };

  const handleArchive = (id: string) => {
    const next = archive(id);
    if (onChange) onChange(next);
  };

  /** SPRINT 2 — the inverse. Same route through the gateway. */
  const handleRestore = (id: string) => {
    const next = restore(id);
    if (onChange) onChange(next);
  };

  const handleDelete = (id: string) => {
    setDeleteConfirm({ id, name: (companies.find(c => c.id === id)?.name) || '' });
    setTypedName('');
  };

  const confirmDelete = () => {
    if (!deleteConfirm) return;
    if (typedName !== deleteConfirm.name) return;
    const next = remove(deleteConfirm.id);
    setDeleteConfirm(null);
    if (onChange) onChange(next);
  };

  /**
   * Archive from inside the refusal dialog — the remedy the copy offers.
   * Uses the SAME `archive` the table row uses; no new behaviour.
   */
  const archiveFromDialog = () => {
    if (!deleteConfirm) return;
    handleArchive(deleteConfirm.id);
    setDeleteConfirm(null);
    setTypedName('');
  };

  const handleLogoChange = (id: string, f?: File) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const company = companies.find(c => c.id === id);
      if (!company) return;
      const updated = { ...company, logoUrl: String(reader.result) };
      handleUpdate(updated);
    };
    reader.readAsDataURL(f);
  };

  /**
   * Does the company being confirmed still have dependents?
   *
   * Read-only. Mirrors what `deleteCompany` enforces so the dialog and the
   * Gateway can never disagree — the Gateway stays the authority, this only
   * previews its answer.
   */
  const deps = deleteConfirm
    ? companyDependencies(deleteConfirm.id, toLinks(projects as any))
    : null;

  return (
    <Dialog open={controlledOpen} onOpenChange={setControlledOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <button className="px-3 py-2 border border-white/[0.06] text-white/40 hover:text-primary">Manage Companies</button>
        </DialogTrigger>
      )}

      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Company Management</DialogTitle>
          {/*
            PATCH — the description previously said deleting a company was
            "destructive". It is not: the Gateway refuses a delete while
            dependents exist, and nothing cascades.
          */}
          <DialogDescription className="text-white/30">Administer enterprise companies — add, edit, archive, or remove companies. A company with sectors or projects cannot be deleted; archive it instead.</DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-white/30">{companies?.length ?? 0} companies</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowWizard(true)} className="flex items-center gap-2 px-3 py-2 bg-primary text-black text-sm font-bold uppercase"><Plus className="w-4 h-4"/> Add Company</button>
            </div>
          </div>

          {!showWizard && (
            <CompanyTable companies={companies} onEdit={c => setEditing(c)} onArchive={handleArchive} onRestore={handleRestore} onDelete={handleDelete} onChangeLogo={handleLogoChange} />
          )}

          {showWizard && (
            <div className="border border-white/[0.06] bg-black/8 p-3">
              <CompanyWizard onCreate={handleCreate} onCancel={() => setShowWizard(false)} />
            </div>
          )}

          {editing && (
            <div className="mt-4 border border-white/[0.06] bg-black/8 p-3">
              <div className="flex items-center justify-between mb-3">
                <div className="text-white font-semibold">Edit Company</div>
                <div className="text-sm text-white/30">ID: {editing.id}</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] text-white/30 mb-1">English Name</label>
                  <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="w-full bg-black/10 border border-white/[0.06] px-3 py-2 text-white" />

                  <label className="block text-[12px] text-white/30 mt-3 mb-1">Arabic Name</label>
                  <input value={(editing as any).nameAr || ''} onChange={e => setEditing({ ...editing, ...({ nameAr: e.target.value } as any) })} className="w-full bg-black/10 border border-white/[0.06] px-3 py-2 text-white" />

                  <label className="block text-[12px] text-white/30 mt-3 mb-1">Description</label>
                  <textarea value={(editing as any).description || ''} onChange={e => setEditing({ ...editing, ...({ description: e.target.value } as any) })} className="w-full bg-black/10 border border-white/[0.06] px-3 py-2 text-white" />

                  <label className="block text-[12px] text-white/30 mt-3 mb-1">Status</label>
                  <select value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value as any })} className="w-full bg-black/10 border border-white/[0.06] px-3 py-2 text-white">
                    <option>Active</option>
                    <option>Paused</option>
                    <option>Archived</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[12px] text-white/30 mb-1">Primary Color</label>
                  <input type="color" value={(editing as any).primaryColor || '#D4AF5A'} onChange={e => setEditing({ ...editing, ...({ primaryColor: e.target.value } as any) })} className="w-16 h-8 p-0" />

                  <label className="block text-[12px] text-white/30 mt-3 mb-1">Secondary Color</label>
                  <input type="color" value={(editing as any).secondaryColor || '#333333'} onChange={e => setEditing({ ...editing, ...({ secondaryColor: e.target.value } as any) })} className="w-16 h-8 p-0" />

                  <label className="block text-[12px] text-white/30 mt-3 mb-1">Logo</label>
                  <input type="file" accept="image/*" onChange={e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const r = new FileReader(); r.onload = () => setEditing({ ...editing, logoUrl: String(r.result) }); r.readAsDataURL(f);
                  }} />

                  {/*
                    REPORTING CURRENCY — the field whose ABSENCE here made
                    every edit fail.

                    `updateCompany` refuses a company with no reporting
                    currency (masterData.ts:716 -> 'missing-currency'), and
                    this form never rendered the field. So opening any
                    company, changing nothing, and pressing Save produced

                        "X" was not saved: a reporting currency is required.

                    with no field on screen to satisfy it. The wizard asks
                    for it on step 2; the edit form simply forgot to.

                    Required, and never defaulted: guessing a currency would
                    silently redenominate every converted figure the company
                    reports.
                  */}
                  <label className="block text-[12px] text-white/30 mt-3 mb-1">
                    Reporting Currency <span className="text-amber-400">(required)</span>
                  </label>
                  <select
                    value={(editing as any).reportingCurrency || ''}
                    onChange={e => setEditing({ ...editing, ...({ reportingCurrency: e.target.value } as any) })}
                    className="w-full bg-black/10 border border-white/[0.06] px-3 py-2 text-white font-mono"
                  >
                    <option value="">Select a reporting currency…</option>
                    {CURRENCY_SEED.filter(c => c.active).map(c => (
                      <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                    ))}
                  </select>
                  {!/^[A-Za-z]{3}$/.test(String((editing as any).reportingCurrency || '').trim()) && (
                    <p className="text-[12px] text-amber-400 mt-1">
                      Required. The company cannot be saved without it.
                    </p>
                  )}

                  <label className="block text-[12px] text-white/30 mt-3 mb-1">Country</label>
                  <input value={(editing as any).country || ''} onChange={e => setEditing({ ...editing, ...({ country: e.target.value } as any) })} className="w-full bg-black/10 border border-white/[0.06] px-3 py-2 text-white" />

                  <label className="block text-[12px] text-white/30 mt-3 mb-1">City</label>
                  <input value={(editing as any).city || ''} onChange={e => setEditing({ ...editing, ...({ city: e.target.value } as any) })} className="w-full bg-black/10 border border-white/[0.06] px-3 py-2 text-white" />

                  <label className="block text-[12px] text-white/30 mt-3 mb-1">Headquarters</label>
                  <input value={(editing as any).headquarters || ''} onChange={e => setEditing({ ...editing, ...({ headquarters: e.target.value } as any) })} className="w-full bg-black/10 border border-white/[0.06] px-3 py-2 text-white" />

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => handleUpdate(editing)}
                      disabled={!/^[A-Za-z]{3}$/.test(String((editing as any).reportingCurrency || '').trim())}
                      className="px-3 py-2 bg-primary text-black font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                    >Save</button>
                    <button onClick={() => setEditing(null)} className="px-3 py-2 border border-white/[0.06] text-white/40">Cancel</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter />

        {/*
          ══════════════════════════════════════════════════════════════
          DELETE DIALOG — two states, chosen by the Gateway's own rule.

          BEFORE this patch there was ONE state, and it claimed:

            "Deleting {name} will also remove related sectors, projects,
             contracts and documents. This action is irreversible."

          Every clause of that was wrong once the Gateway landed:
            · nothing cascades — the delete is REFUSED while dependents
              exist, so sectors and projects are never removed with it;
            · Timeline, FX History and Baselines are retained by design;
            · a delete that cannot happen is not "irreversible".

          Now the dialog asks `companyDependencies()` — the same rule
          `deleteCompany` enforces — and shows the matching wording. The
          two can no longer disagree.
          ══════════════════════════════════════════════════════════════
        */}
        {deleteConfirm && deps && !deps.deletable && (
          <div className="mt-4 p-4 border border-amber-500/30 bg-black/8">
            <div className="flex items-center gap-2 text-amber-400 font-semibold mb-2">
              <AlertTriangle className="w-4 h-4" />
              Cannot Delete Company
            </div>

            <div className="text-white/30 mb-2">
              This company cannot be deleted while dependent sectors or projects exist.
              Archive the company instead, or remove dependent records first.
            </div>

            {deps.blockers.length > 0 && (
              <div className="text-[12px] text-white/40 mb-2">
                <span className="text-white/60 font-medium">{deleteConfirm.name}</span>
                {' — '}{deps.blockers.join(' · ')}
              </div>
            )}

            <div className="text-[12px] text-emerald-400/80 mb-3">
              Historical data, Timeline, FX History, Baselines and Snapshots are never deleted automatically.
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => { setDeleteConfirm(null); setTypedName(''); }} className="px-3 py-2 border border-white/[0.06] text-white/40">Cancel</button>
              <button onClick={archiveFromDialog} className="px-3 py-2 bg-primary text-black font-bold inline-flex items-center gap-2">
                <Archive className="w-4 h-4" />
                Archive Company
              </button>
            </div>
          </div>
        )}

        {/*
          Ordinary confirmation — reached ONLY when the company has no
          sectors and no projects, so there is nothing to cascade to. The
          copy says exactly what goes and what stays.
        */}
        {deleteConfirm && deps && deps.deletable && (
          <div className="mt-4 p-4 border border-red-600/30 bg-black/8">
            <div className="text-red-400 font-semibold mb-2">Delete Company</div>
            <div className="text-white/30 mb-2">
              Deleting <span className="text-white font-medium">{deleteConfirm.name}</span> removes the company record.
              It has no sectors and no projects, so nothing else is affected.
            </div>
            <div className="text-[12px] text-emerald-400/80 mb-3">
              Historical data, Timeline, FX History, Baselines and Snapshots are never deleted automatically.
            </div>
            <div className="mb-3">
              <label className="block text-[12px] text-white/30 mb-1">Type the company name to confirm</label>
              <input value={typedName} onChange={e => setTypedName(e.target.value)} className="w-full bg-black/10 border border-white/[0.06] px-3 py-2 text-white" />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={confirmDelete} disabled={typedName !== deleteConfirm.name} className="px-3 py-2 bg-red-600 text-black font-bold disabled:opacity-50">Delete company</button>
              <button onClick={() => { setDeleteConfirm(null); setTypedName(''); }} className="px-3 py-2 border border-white/[0.06] text-white/40">Cancel</button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
