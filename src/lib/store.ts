import { useState, useEffect } from 'react';
import { Project, User, ProjectPermission, INITIAL_PROJECTS, INITIAL_USERS } from './data';
import { initializeAllProjects, initializeProjectStorage, disposeProjectStorage } from './projectLifecycle';
// PHASE 3G — master data start-up: seed, back-fill legacy parentage,
// rebuild the derived sector cache. Idempotent and non-destructive.
import { bootstrapMasterData } from './masterDataBootstrap';
// Task 1 — archive rules live in projectMaster; the store only commits.
import { archiveProject, unarchiveProject } from './projectMaster';
import { MOCK_COMPANIES } from '../mock/companies';
import { MOCK_SECTORS } from '../mock/sectors';

// ── Auth ─────────────────────────────────────────────────────────────────────
export function useAuth() {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const authData = localStorage.getItem('pactum-auth');
    if (authData) {
      setUserState(JSON.parse(authData));
    }
    setLoading(false);
  }, []);

  const login = (userData: User) => {
    localStorage.setItem('pactum-auth', JSON.stringify(userData));
    setUserState(userData);
  };

  const logout = () => {
    localStorage.removeItem('pactum-auth');
    setUserState(null);
  };

  // re-hydrate user from users store so permissions are always fresh
  const refreshUser = () => {
    const stored = localStorage.getItem('pactum-users');
    const users: User[] = stored ? JSON.parse(stored) : INITIAL_USERS;
    const authData = localStorage.getItem('pactum-auth');
    if (!authData) return;
    const current: User = JSON.parse(authData);
    const fresh = users.find((u) => u.username === current.username);
    if (fresh) {
      localStorage.setItem('pactum-auth', JSON.stringify(fresh));
      setUserState(fresh);
    }
  };

  return { user, login, logout, loading, refreshUser };
}

// ── Projects ─────────────────────────────────────────────────────────────────
//
// SHARED MODULE-LEVEL STORE (replaces per-caller useState).
//
// WHY
//   useProjects() used to call useState<Project[]>([]) inside every component,
//   so each caller owned an independent copy. ProjectDashboard held copy A and
//   passed `project` down as a prop; DelayModule held copy B and wrote through
//   it. Copy A never heard about the write, so the prop stayed stale and edited
//   inputs snapped back — even though localStorage was already correct.
//
//   Second defect: the mutators mapped over their own closure array. Called
//   before that instance's useEffect had loaded, `projects` was still [] and
//   [].map() wrote an empty array over pactum-projects, wiping every project.
//
// WHAT CHANGED
//   Internal mechanism only. One module-level array plus a Set of subscribers.
//   The returned object is unchanged:
//       { projects, addProject, deleteProject, updateProject }
//   No caller needs any change. Same storage key, same JSON shape, so no
//   migration. Lifecycle hooks (initializeAllProjects / initializeProjectStorage
//   / disposeProjectStorage) fire exactly as before.

const PROJECTS_KEY = 'pactum-projects';

/** Single source of truth. `null` means "not yet hydrated from localStorage". */
let projectsState: Project[] | null = null;

/** Every mounted useProjects() instance registers its setter here. */
const projectSubscribers = new Set<(next: Project[]) => void>();

/** Guarantees initializeAllProjects runs once per page load, not per instance. */
let projectsLifecycleInitialized = false;

/**
 * Reads the canonical array straight from localStorage, seeding
 * INITIAL_PROJECTS on first ever run. Never returns null — a parse failure
 * falls back to the seed rather than to an empty array, so a corrupt value can
 * never present itself as "no projects" and then get written back as [].
 */
function readProjectsFromStorage(): Project[] {
  try {
    const stored = localStorage.getItem(PROJECTS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed as Project[];
    }
  } catch {
    /* corrupt JSON — fall through to the seed */
  }
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(INITIAL_PROJECTS));
  return INITIAL_PROJECTS;
}

/**
 * Guarantees projectsState is populated before any read or mutation.
 * A mutator called before hydration reads localStorage directly instead of
 * operating on an empty array — this is what closes the wipe landmine.
 */
function ensureProjectsHydrated(): Project[] {
  if (projectsState === null) {
    projectsState = readProjectsFromStorage();
  }
  return projectsState;
}

/** Persist + notify every mounted instance. The only writer. */
function commitProjects(next: Project[]): void {
  projectsState = next;
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
  } catch {
    /* quota exceeded — in-memory state still updated */
  }
  // Copy the Set before iterating: a subscriber may unmount during notify.
  Array.from(projectSubscribers).forEach((fn) => fn(next));
}

/**
 * Re-reads `pactum-projects` from localStorage and republishes it to every
 * mounted consumer.
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — a measured defect, not a precaution
 *
 * `projectsState` is a module-level cache hydrated once per page load.
 * Every in-app mutation goes through `commitProjects`, which updates the
 * cache AND notifies, so the two can never drift.
 *
 * A bulk importer is the one writer that cannot use that path: it writes
 * `pactum-projects` wholesale, outside React, before any component has
 * asked for it. The cache was therefore never told, and the UI kept
 * serving the pre-import array.
 *
 * MEASURED, with the certification dataset seeded:
 *
 *   storage        ECD-S1.projectIds = ["ECD-P1","ECD-P2"]   correct
 *   in-app nav     "No Projects In This Sector"              WRONG
 *   hard reload    Metro Line A visible                      correct
 *
 * A hard reload fixed it, which is exactly how the defect stayed hidden:
 * the automated sweep navigated with full page loads and scored 55/55,
 * while a human clicking through the SPA saw an empty sector.
 *
 * WHAT THIS IS NOT
 *
 *   It is not a second write path. It performs no write, invents no
 *   record and changes no shape — it re-reads the file that is already
 *   the source of truth and pushes it through the SAME notifier every
 *   other mutation uses. Nothing about project lifecycle, storage keys
 *   or business rules is altered.
 * ══════════════════════════════════════════════════════════════════════
 */
export function refreshProjectsFromStorage(): Project[] {
  const next = readProjectsFromStorage();
  projectsState = next;
  Array.from(projectSubscribers).forEach((fn) => fn(next));
  return next;
}

export function useProjects() {
  // Seed from the shared store, not from []. First render already has data.
  const [projects, setProjects] = useState<Project[]>(() =>
    typeof window === 'undefined' ? [] : ensureProjectsHydrated()
  );

  useEffect(() => {
    const current = ensureProjectsHydrated();

    // Project storage is owned by the project lifecycle, not by any page.
    // Every consumer can read project data without the user having opened
    // that project first. Non-destructive — existing data is never touched.
    // Guarded so it runs once per page load rather than once per instance.
    if (!projectsLifecycleInitialized) {
      projectsLifecycleInitialized = true;
      initializeAllProjects(current);

      // ── PHASE 3G · master data ──────────────────────────────────────
      //
      // Seeds Companies/Sectors on first run, recovers companyId/sectorId
      // for projects created before the link existed, and rebuilds the
      // derived `sector.projectIds` cache the older call sites read.
      //
      // The patched project list is COMMITTED only when the back-fill
      // actually changed something, so a normal load performs no write.
      // Guarded so a bad seed can never take the whole app down with it.
      try {
        const boot = bootstrapMasterData(current, MOCK_COMPANIES, MOCK_SECTORS);
        if (boot.projectsChanged) commitProjects(boot.projects as Project[]);
      } catch {
        /* master data unavailable — the app still runs on project data */
      }
    }

    // The shared array may have changed between this component's render and
    // this effect running. Re-sync before subscribing so nothing is missed.
    setProjects((prev) => (prev === current ? prev : current));

    projectSubscribers.add(setProjects);
    return () => {
      projectSubscribers.delete(setProjects);
    };
  }, []);

  // ── Mutators ──
  // Each calls ensureProjectsHydrated() FIRST so it always operates on the
  // current shared array, never on a stale closure.

  const addProject = (p: Project) => {
    const current = ensureProjectsHydrated();
    commitProjects([...current, p]);
    // Create the new project's storage at creation time.
    initializeProjectStorage(p);
  };

  const deleteProject = (id: string) => {
    const current = ensureProjectsHydrated();
    commitProjects(current.filter((proj) => proj.id !== id));
    // Remove owned storage so nothing is orphaned.
    disposeProjectStorage(id);
  };

  /**
   * PHASE 3F-UX · Task 1 — archive instead of destroy.
   *
   * Reversible and NON-DESTRUCTIVE: no storage bucket is touched, the
   * timeline and baseline archives are untouched, and the project stays
   * fully readable. Only its `status` changes, so every existing consumer
   * that ignores `status` behaves exactly as before.
   *
   * The archive/restore RULES live in `projectMaster`; this only commits
   * what they return. No logic is duplicated here.
   */
  const archive = (id: string, by: string, note = '') => {
    const current = ensureProjectsHydrated();
    const target = current.find((p) => p.id === id);
    if (!target) return;
    const r = archiveProject(target as any, by, note);
    if (r.ok && r.record) {
      commitProjects(current.map((p) => (p.id === id ? (r.record as Project) : p)));
    }
  };

  // `by` and `note` are recorded as a RESTORE event; the prior archive
  // event is preserved. See unarchiveProject.
  const unarchive = (id: string, by = 'unknown', note = '') => {
    const current = ensureProjectsHydrated();
    const target = current.find((p) => p.id === id);
    if (!target) return;
    const r = unarchiveProject(target as any, by, note);
    if (r.ok && r.record) {
      commitProjects(current.map((p) => (p.id === id ? (r.record as Project) : p)));
    }
  };

  const updateProject = (p: Project) => {
    const current = ensureProjectsHydrated();
    // If the id is somehow absent, append rather than silently dropping the
    // write. Prevents an edit vanishing without trace.
    const exists = current.some((proj) => proj.id === p.id);
    const next = exists
      ? current.map((proj) => (proj.id === p.id ? p : proj))
      : [...current, p];
    commitProjects(next);
  };

  return { projects, addProject, deleteProject, updateProject, archiveProject: archive, unarchiveProject: unarchive };
}

// ── Users ────────────────────────────────────────────────────────────────────
export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('pactum-users');
    if (stored) {
      // migrate old format: add projectPermissions if missing
      const parsed: User[] = JSON.parse(stored);
      const migrated = parsed.map((u) => ({
        ...u,
        projectPermissions: u.projectPermissions ?? (u.accessibleProjects ?? []).map((id) => ({
          projectId: id,
          canView: true,
          canEdit: false,
        })),
      }));
      setUsers(migrated);
    } else {
      localStorage.setItem('pactum-users', JSON.stringify(INITIAL_USERS));
      setUsers(INITIAL_USERS);
    }
  }, []);

  const persist = (next: User[]) => {
    setUsers(next);
    localStorage.setItem('pactum-users', JSON.stringify(next));
    // keep auth session in sync if the current user changed
    const authData = localStorage.getItem('pactum-auth');
    if (authData) {
      const current: User = JSON.parse(authData);
      const updated = next.find((u) => u.username === current.username);
      if (updated) localStorage.setItem('pactum-auth', JSON.stringify(updated));
    }
  };

  const addUser = (u: User) => persist([...users, u]);

  const updateUser = (u: User) => persist(users.map((x) => (x.username === u.username ? u : x)));

  const deleteUser = (username: string) =>
    persist(users.filter((u) => u.username !== username));

  // set a single permission for a user on a project
  const setPermission = (username: string, projectId: string, patch: Partial<ProjectPermission>) => {
    const updated = users.map((u) => {
      if (u.username !== username) return u;
      const existing = u.projectPermissions.find((p) => p.projectId === projectId);
      let newPerms: ProjectPermission[];
      if (existing) {
        newPerms = u.projectPermissions.map((p) =>
          p.projectId === projectId ? { ...p, ...patch } : p
        );
      } else {
        newPerms = [
          ...u.projectPermissions,
          { projectId, canView: false, canEdit: false, ...patch },
        ];
      }
      // keep legacy accessibleProjects in sync
      const accessibleProjects = newPerms.filter((p) => p.canView).map((p) => p.projectId);
      return { ...u, projectPermissions: newPerms, accessibleProjects };
    });
    persist(updated);
  };

  return { users, addUser, updateUser, deleteUser, setPermission };
}

// ── Permission helpers ───────────────────────────────────────────────────────
export function getProjectPermission(user: User | null, projectId: string): ProjectPermission {
  if (!user) return { projectId, canView: false, canEdit: false };
  if (user.role === 'admin') return { projectId, canView: true, canEdit: true };
  const perm = (user.projectPermissions ?? []).find((p) => p.projectId === projectId);
  return perm ?? { projectId, canView: false, canEdit: false };
}
