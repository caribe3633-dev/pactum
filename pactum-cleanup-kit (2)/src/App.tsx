import React from 'react';
import { Switch, Route, useLocation } from 'wouter';
import { Shell } from './components/Shell';

import LoginPage from './pages/LoginPage';
import PortalPage from './pages/PortalPage';
import CompanyAnalyticsPage from './pages/CompanyAnalyticsPage';
import EnterprisePortfolioPage from './pages/EnterprisePortfolioPage';
import PortfolioAnalyticsPage from './pages/PortfolioAnalyticsPage';
import FinancialIntelligencePage from './pages/FinancialIntelligencePage';
import CompanyPage from './pages/CompanyPage';
import CompanySectorsPage from './pages/CompanySectorsPage';
import CompanySubcontractorsPage from './pages/CompanySubcontractorsPage';
import CompanyCurrencyPage from './pages/CompanyCurrencyPage';
import SubcontractorDashboardPage from './pages/SubcontractorDashboardPage';
import SectorPage from './pages/SectorPage';
import SectorAnalyticsPage from './pages/SectorAnalyticsPage';
import ArchivePage from './pages/ArchivePage';
import ProjectDashboardPage from './pages/ProjectDashboardPage';
import AdminPage from './pages/AdminPage';
import AboutPage from './pages/AboutPage';
import PlaceholderPage from './pages/PlaceholderPage';
import NotFound from './pages/not-found';

const HOME = '/enterprise-portfolio';

// مكون إعادة توجيه آمن ومتوافق مع Wouter
function Redirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  React.useEffect(() => {
    setLocation(to);
  }, [setLocation, to]);
  return null;
}

export default function App() {
  return (
    <Switch>
      {/* Public Login Route */}
      <Route path="/login" component={LoginPage} />

      {/* Protected Routes inside Shell Layout */}
      <Route>
        <Shell>
          <Switch>
            <Route path="/portal" component={PortalPage} />
            {/* Phase 7 — Enterprise Analytics. Registered BEFORE the bare
                portfolio route: wouter matches in order, and an exact path
                must be declared before any that could shadow it. */}
            <Route path="/enterprise-portfolio/analytics" component={PortfolioAnalyticsPage} />
            <Route path="/enterprise-portfolio/intelligence" component={FinancialIntelligencePage} />
            <Route path="/enterprise-portfolio" component={EnterprisePortfolioPage} />
            <Route path="/company" component={CompanyPage} />
            <Route path="/company/:id/analytics" component={CompanyAnalyticsPage} />
            <Route path="/company/:companyId/subcontractors/:internalId" component={SubcontractorDashboardPage} />
            <Route path="/company/:id/subcontractors" component={CompanySubcontractorsPage} />
            {/* Finance — Currency Management + FX Dashboard.
                Placed BEFORE /company/:id: wouter matches in order, and the
                bare :id route would otherwise swallow /currency. */}
            <Route path="/company/:id/currency" component={CompanyCurrencyPage} />
            <Route path="/company/:id" component={CompanySectorsPage} />
            <Route path="/sector" component={SectorPage} />
            <Route path="/sector/:id/analytics" component={SectorAnalyticsPage} />
            <Route path="/sector/:id" component={SectorPage} />
            <Route path="/project/:id" component={ProjectDashboardPage} />
            <Route path="/about" component={AboutPage} />
            <Route path="/admin" component={AdminPage} />
            <Route path="/archive" component={ArchivePage} />
            <Route path="/placeholder" component={PlaceholderPage} />

            {/* Legacy redirect — /portfolio is now per-company analytics */}
            <Route path="/portfolio">{() => <Redirect to={HOME} />}</Route>

            {/* Root redirect */}
            <Route path="/">{() => <Redirect to={HOME} />}</Route>

            {/* 404 Fallback */}
            <Route component={NotFound} />
          </Switch>
        </Shell>
      </Route>
    </Switch>
  );
}
