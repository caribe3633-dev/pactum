import React from 'react';
import PageContainer from '../components/PageContainer';
import Breadcrumb from '../components/Breadcrumb';
import { findCompanyById } from '../mock/companies';
import { findSectorsByCompany } from '../mock/sectors';
import { useProjects } from '../lib/store';
import { Link, useLocation } from 'wouter';

export default function CompanyDashboard({ params }: any) {
  const id = params?.id || 'unknown';
  const company = findCompanyById(id);
  const sectors = findSectorsByCompany(id);
  const { projects } = useProjects();
  const [loc, setLoc] = useLocation();

  if (!company) return (
    <PageContainer title="Company Dashboard">
      <Breadcrumb items={[{ label: 'Enterprise' }, { label: 'Unknown company' }]} />
      <div className="p-6 text-white/30">Company not found</div>
    </PageContainer>
  );

  const companyProjects = projects.filter(p => {
    // projects referenced by sectors for this company
    const inSector = sectors.some(s => s.projectIds.includes(p.id));
    return inSector;
  });

  return (
    <PageContainer title={company.name}>
      <Breadcrumb items={[{ label: 'Enterprise' }, { label: company.name }]} />

      {/* Company info + KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="p-4 border border-white/[0.06] bg-black/10">
          <div className="text-white font-semibold">Company Information</div>
          <div className="text-[12px] text-white/30 mt-2">Status: {company.status}</div>
          <div className="text-[12px] text-white/30">Portfolio: SAR {company.portfolioValue.toLocaleString()}</div>
        </div>
        <div className="p-4 border border-white/[0.06] bg-black/10">
          <div className="text-white font-semibold">KPIs</div>
          <div className="text-[12px] text-white/30 mt-2">Sectors: {sectors.length}</div>
          <div className="text-[12px] text-white/30">Projects (linked): {companyProjects.length}</div>
        </div>
        <div className="p-4 border border-white/[0.06] bg-black/10">
          <div className="text-white font-semibold">Compliance</div>
          <div className="text-[12px] text-white/30 mt-2">{company.compliance}</div>
        </div>
      </div>

      {/* Sectors */}
      <div className="mb-4">
        <h3 className="text-white font-semibold mb-2">Sectors</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {sectors.map(s => (
            <div key={s.id} className="p-4 border border-white/[0.06] bg-black/10 flex flex-col h-full">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-white font-semibold">{s.name}</div>
                  <div className="text-[12px] text-white/30">Projects: {s.projectIds.length}</div>
                </div>
                <div className="text-white/30 text-sm">&nbsp;</div>
              </div>
              <div className="flex-1" />
              <div className="flex items-center justify-end">
                <button onClick={() => setLoc(`/sector/${s.id}`)} className="px-3 py-1 bg-primary text-black font-bold uppercase text-sm">Open Sector</button>
              </div>
            </div>
          ))}
        </div>
      </div>

    </PageContainer>
  );
}
