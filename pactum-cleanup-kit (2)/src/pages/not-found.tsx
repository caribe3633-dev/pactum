import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    // Was a light-grey card on a dark ERP — corrected to the PACTUM surface.
    <div className="min-h-full w-full flex items-center justify-center bg-background p-6">
      <div className="ds-card ds-card-exec w-full max-w-md">
        <div className="flex items-center gap-3 !mt-0">
          <AlertCircle className="h-7 w-7 text-destructive flex-shrink-0" />
          <h1 className="t-section">404 — Page Not Found</h1>
        </div>
        <p className="ds-empty-sub">
          This route is not registered in the router.
        </p>
      </div>
    </div>
  );
}
