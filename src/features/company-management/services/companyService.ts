import { fetchCompanies as fetchMockCompanies, persistCompanies as persistMockCompanies, Company } from '../../../mock/companies';

const STORAGE_KEY = 'pactum-enterprise-companies';

export function loadCompanies(): Company[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try { return JSON.parse(stored) as Company[]; } catch { /* fallthrough */ }
  }
  // fallback to mock layer
  return fetchMockCompanies();
}

export function saveCompanies(companies: Company[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(companies));
  } catch (e) {
    // ignore quota errors for now
    console.error('Failed to persist companies to localStorage', e);
  }
  // call mock persist for parity and future replacement
  persistMockCompanies(companies);
}

export function addCompany(companies: Company[], c: Company) {
  const next = [c, ...companies];
  saveCompanies(next);
  return next;
}

export function updateCompany(companies: Company[], c: Company) {
  const next = companies.map(x => x.id === c.id ? c : x);
  saveCompanies(next);
  return next;
}

export function deleteCompany(companies: Company[], id: string) {
  const next = companies.filter(x => x.id !== id);
  saveCompanies(next);
  return next;
}

export function archiveCompany(companies: Company[], id: string) {
  const next = companies.map(x => x.id === id ? { ...x, status: 'Archived' } : x);
  saveCompanies(next);
  return next;
}

export function unarchiveCompany(companies: Company[], id: string) {
  const next = companies.map(x => x.id === id ? { ...x, status: 'Active' } : x);
  saveCompanies(next);
  return next;
}
