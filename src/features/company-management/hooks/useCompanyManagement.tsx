import { useState, useEffect } from 'react';
import { loadCompanies, saveCompanies, addCompany as svcAdd, updateCompany as svcUpdate, deleteCompany as svcDelete, archiveCompany as svcArchive } from '../services/companyService';
import { Company } from '../types';

export function useCompanyManagement(initial?: Company[]) {
  const [companies, setCompanies] = useState<Company[]>(initial ?? []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (initial && initial.length > 0) {
      setCompanies(initial);
      setLoading(false);
      return;
    }
    const loaded = loadCompanies();
    setCompanies(loaded);
    setLoading(false);
  }, []); // load once

  const add = (c: Company) => {
    const next = svcAdd(companies, c);
    setCompanies(next);
    saveCompanies(next);
    return next;
  };

  const update = (c: Company) => {
    const next = svcUpdate(companies, c);
    setCompanies(next);
    saveCompanies(next);
    return next;
  };

  const remove = (id: string) => {
    const next = svcDelete(companies, id);
    setCompanies(next);
    saveCompanies(next);
    return next;
  };

  const archive = (id: string) => {
    const next = svcArchive(companies, id);
    setCompanies(next);
    saveCompanies(next);
    return next;
  };

  return { companies, loading, add, update, remove, archive, setCompanies };
}
