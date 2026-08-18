import { Company as MockCompany } from '../../../mock/companies';

export type Company = MockCompany;

export interface CompanyFormData {
  id?: string;
  name?: string;
  nameAr?: string;
  code?: string;
  description?: string;
  logoUrl?: string | undefined;
  primaryColor?: string;
  secondaryColor?: string;
  status?: 'Active' | 'Paused' | 'Archived';
  portfolioValue?: number;
  sectors?: number;
  projects?: number;
  riskRating?: MockCompany['riskRating'];
  compliance?: MockCompany['compliance'];
}
