export interface ProjectPermission {
  projectId: string;
  canView: boolean;
  canEdit: boolean; // data entry: add rows, edit fields
}

export interface User {
  username: string;
  password?: string; // stored for admin-managed users
  role: 'admin' | 'viewer';
  accessibleProjects: string[]; // kept for backward compat — derived from projectPermissions
  projectPermissions: ProjectPermission[];
}

export interface Project {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;

  /**
   * PHASE 3F/3G — the authoritative link to the hierarchy.
   *
   * Before this, the relationship lived only inside `sector.projectIds`,
   * which had no writer. A project created through the UI could therefore
   * never be attached to anything: it was invisible to six pages and was
   * silently bound to the wrong currency book (Phase 3E CRIT-3E-01).
   *
   * OPTIONAL in the type so projects stored before the change still parse.
   * `projectMaster.createProject` REQUIRES both, and
   * `masterDataBootstrap` back-fills legacy rows where the answer is
   * unambiguous. A row still missing them is reported as an orphan rather
   * than assigned a guessed parent.
   */
  companyId?: string;
  sectorId?: string;

  /** Lifecycle state. Absent means Active. Archived rows are hidden. */
  status?: 'Active' | 'On Hold' | 'Completed' | 'Archived';
  /**
   * CONTRACT PHASE — المرحلة التعاقدية (من تاب العقد).
   * اختيارية: المشاريع اللي اتخزنت قبل الكارت مالهاش قيمة = "لم تُحدد".
   * التصنيف الكامل في lib/contractPhases.ts
   */
  contractPhase?: string;
  archivedAt?: string;
  archivedBy?: string;
  /**
   * Permanent archive/restore history. Append-only: a restore ADDS an
   * event, it never erases the archive that preceded it. Defined in
   * projectMaster.ts, mirrored here so the stored Project carries it.
   */
  archiveLog?: { action: 'archived' | 'restored'; at: string; by: string; note: string }[];

  country?: string;       // ISO 3166-1 alpha-2 country code
  cityEn: string;
  cityAr: string;
  contractValue: number;
  progress: number;
  delayDays: number;
  image?: string;

  // Overview details
  revisedContractValue: number;
  totalApprovedCOs: number;
  totalApprovedClaims: number;
  totalCashReceived: number;
  totalCashDisbursed: number;
  /**
   * Site commencement / notice-to-proceed date. Day zero of the programme.
   * Baseline Finish and Approved Finish are measured FROM this date.
   * Optional: an older project without one falls back to the stored
   * contractualCompletion / approvedCompletion, unchanged.
   */
  commencementDate?: string;
  /** Contract duration in days from commencement. Optional. */
  plannedDurationDays?: number;
  contractualCompletion: string;
  approvedCompletion: string;

  // Liquidated Damages — both manually entered, both optional.
  /** Daily LD rate in project currency. */
  ldRatePerDay?: number;
  /**
   * Absolute LD cap in project currency, already worked out from that
   * contract's clause. Never derived from contractValue — clauses differ
   * per contract. 0 or undefined means "no cap entered".
   */
  ldCapAmount?: number;
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * PRE-PRODUCTION CLEAN SLATE — NO DEMO PROJECTS.
 *
 * This held four fully-formed demonstration projects — Riyadh Commercial
 * Tower and its siblings — with contract values, progress percentages,
 * delay days and cash figures. `readProjectsFromStorage` writes them on
 * first run, so a brand-new installation opened onto somebody else's
 * portfolio and the first real contract would have been entered beside
 * four fictions.
 *
 * It is now EMPTY. The export is retained because `store.ts` and
 * `LoginPage` import it; an empty array is a valid, honest answer and
 * keeps those call sites unchanged.
 * ══════════════════════════════════════════════════════════════════════
 */
export const INITIAL_PROJECTS: Project[] = [];

/**
 * The system administrator. NOT demo data — without an account the
 * application cannot be logged into or administered at all.
 *
 * The `viewer` demo account was removed: it existed only to show what a
 * restricted user sees, and it carried permissions to demo projects that
 * no longer exist. Real users are created in the Admin Console.
 *
 * `accessibleProjects` and `projectPermissions` are empty because there
 * are no projects yet. An admin is granted everything by role, so this
 * costs nothing.
 */
export const INITIAL_USERS: User[] = [
  {
    username: 'admin',
    password: '123456789',
    role: 'admin',
    accessibleProjects: [],
    projectPermissions: [],
  },
];

export function generateId() {
  return Math.random().toString(36).substring(2, 9);
}
