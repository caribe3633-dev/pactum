import React, { useState, useEffect } from 'react';
import { useUsers, useProjects, useAuth } from '../lib/store';
import { useTranslation } from '../lib/i18n';
import { ProjectPermission } from '../lib/data';
import {
  User,
  ShieldAlert,
  KeyRound,
  Plus,
  Eye,
  EyeOff,
  Pencil,
  PencilOff,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '../lib/utils';
// Phase 3H — Enterprise / Factory reset.
import EnterpriseReset from '../components/EnterpriseReset';
// Scoped permissions, transfers, audit trail and version history.
// Mounted inside the existing console; nothing above it was redesigned.
import AccessControlPanel from '../components/AccessControlPanel';
import { ensureRootAdmin } from '../lib/authz';
// PHASE 0-B — the certification dataset is reinstated after every major
// architectural change, so it needs a control beside the reset it pairs with.
import CertificationDataset from '../components/CertificationDataset';
import CurrencyMigrationPanel from '../components/CurrencyMigrationPanel';
// Repairs cash ledgers written by the pre-fix certificate sync. Sits with
// the migration because it is the same class of operation: it rewrites
// filed financial records, so it is admin-gated and dry-run first.
import CashSyncRepairPanel from '../components/CashSyncRepairPanel';

export default function AdminPage() {
  const { users, addUser, deleteUser, setPermission } = useUsers();
  const { projects } = useProjects();
  const { t, lang } = useTranslation();
  const { user: currentUser } = useAuth();

  /**
   * Seed the founding administrator.
   *
   * `canGrant` refuses everyone who holds no admin grant, so without a
   * first one the console would be a locked room with the key inside.
   * `ensureRootAdmin` is idempotent: it does nothing once any global
   * admin grant exists, so this cannot mint a second one.
   */
  useEffect(() => {
    if (currentUser?.role === 'admin' && currentUser.username) {
      ensureRootAdmin(currentUser.username);
    }
  }, [currentUser?.role, currentUser?.username]);

  const [isAdding, setIsAdding] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'viewer'>('viewer');
  const [error, setError] = useState('');

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!newUsername.trim() || !newPassword.trim()) return;
    if (users.find((u) => u.username === newUsername.trim())) {
      setError(lang === 'ar' ? 'اسم المستخدم موجود بالفعل' : 'Username already exists');
      return;
    }
    addUser({
      username: newUsername.trim(),
      password: newPassword.trim(),
      role: newRole,
      accessibleProjects: [],
      projectPermissions: [],
    });
    setNewUsername('');
    setNewPassword('');
    setIsAdding(false);
  };

  const getPermForProject = (username: string, projectId: string): ProjectPermission => {
    const u = users.find((x) => x.username === username);
    if (!u) return { projectId, canView: false, canEdit: false };
    if (u.role === 'admin') return { projectId, canView: true, canEdit: true };
    return (
      (u.projectPermissions ?? []).find((p) => p.projectId === projectId) ?? {
        projectId,
        canView: false,
        canEdit: false,
      }
    );
  };

  const toggleView = (username: string, projectId: string) => {
    const perm = getPermForProject(username, projectId);
    const next = !perm.canView;
    // if removing view, also remove edit
    setPermission(username, projectId, { canView: next, canEdit: next ? perm.canEdit : false });
  };

  const toggleEdit = (username: string, projectId: string) => {
    const perm = getPermForProject(username, projectId);
    if (!perm.canView) return; // must have view first
    setPermission(username, projectId, { canEdit: !perm.canEdit });
  };

  return (
    <div className="pg pg-stack z-10">
      {/* Header */}
      <div className="flex items-center gap-4 mb-10 border-b border-white/10 pb-6">
        <ShieldAlert className="w-8 h-8 text-primary flex-shrink-0" />
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">
            {lang === 'ar' ? 'لوحة التحكم — صلاحيات المستخدمين' : 'Admin — Access Control'}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {lang === 'ar'
              ? 'تحديد صلاحيات العرض وإدخال البيانات لكل مستخدم ومشروع'
              : 'Set view and data-entry permissions per user per project'}
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-6 mb-8 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-primary" />
          <span>{lang === 'ar' ? 'عرض المشروع' : 'Can View Project'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Pencil className="w-4 h-4 text-chart-4" />
          <span>{lang === 'ar' ? 'إدخال البيانات (إضافة / تعديل)' : 'Data Entry (add / edit rows)'}</span>
        </div>
        <div className="flex items-center gap-2">
          <EyeOff className="w-4 h-4 text-white/20" />
          <span>{lang === 'ar' ? 'لا وصول' : 'No Access'}</span>
        </div>
      </div>

      {/* Add user bar */}
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-lg font-serif text-white">
          {lang === 'ar' ? 'المستخدمون' : 'Users'}{' '}
          <span className="text-muted-foreground text-sm font-sans">({users.length})</span>
        </h2>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-2 text-sm bg-black/40 border border-white/10 px-4 py-2 hover:bg-white/5 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {lang === 'ar' ? 'مستخدم جديد' : 'Add User'}
        </button>
      </div>

      {isAdding && (
        <div className="mb-8 pactum-card p-6 bg-black/30 border-l-2 rtl:border-l-0 rtl:border-r-2 border-primary">
          <h3 className="text-sm uppercase tracking-wider text-muted-foreground mb-4">
            {lang === 'ar' ? 'إضافة مستخدم جديد' : 'New User'}
          </h3>
          <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-1">
              <label className="text-(length:--t-label) uppercase text-muted-foreground">
                {lang === 'ar' ? 'اسم المستخدم' : 'Username'}
              </label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                dir="ltr"
                className="w-full bg-black/60 border border-white/10 px-3 py-2 font-mono text-sm focus:outline-none focus:border-primary"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-(length:--t-label) uppercase text-muted-foreground">
                {lang === 'ar' ? 'كلمة المرور' : 'Password'}
              </label>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                dir="ltr"
                className="w-full bg-black/60 border border-white/10 px-3 py-2 font-mono text-sm focus:outline-none focus:border-primary"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-(length:--t-label) uppercase text-muted-foreground">
                {lang === 'ar' ? 'الدور' : 'Role'}
              </label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as any)}
                className="w-full bg-black/60 border border-white/10 px-3 py-2 text-foreground text-sm focus:outline-none focus:border-primary"
              >
                <option value="viewer">{lang === 'ar' ? 'مشاهد (مقيد)' : 'Viewer (Restricted)'}</option>
                <option value="admin">{lang === 'ar' ? 'مدير النظام' : 'Administrator'}</option>
              </select>
            </div>
            <div className="md:col-span-3 flex items-center gap-3">
              <button
                type="submit"
                className="bg-primary text-primary-foreground px-6 py-2 uppercase font-medium text-sm hover:bg-primary/90 transition-colors"
              >
                {lang === 'ar' ? 'حفظ' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => { setIsAdding(false); setError(''); }}
                className="text-muted-foreground text-sm hover:text-foreground"
              >
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              {error && <p className="text-destructive text-sm">{error}</p>}
            </div>
          </form>
        </div>
      )}

      {/* Users list */}
      <div className="space-y-4">
        {users.map((u) => {
          const isMe = u.username === currentUser?.username;
          const isExpanded = expandedUser === u.username;
          return (
            <div key={u.username} className="pactum-card bg-black/20 overflow-hidden">
              {/* User header row */}
              <div
                className="flex items-center gap-4 p-5 cursor-pointer hover:bg-white/[0.02] transition-colors"
                onClick={() => setExpandedUser(isExpanded ? null : u.username)}
              >
                <div className="w-10 h-10 bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-base font-bold text-foreground">{u.username}</span>
                    <span
                      className={cn(
                        'text-(length:--t-second) uppercase px-2 py-0.5 font-bold tracking-widest border',
                        u.role === 'admin'
                          ? 'bg-primary/20 text-primary border-primary/30'
                          : 'bg-white/10 text-muted-foreground border-white/20'
                      )}
                    >
                      {u.role}
                    </span>
                    {isMe && (
                      <span className="text-(length:--t-label) text-chart-4 uppercase tracking-wider">
                        ({lang === 'ar' ? 'أنت' : 'You'})
                      </span>
                    )}
                  </div>
                  {u.role !== 'admin' && (
                    <p className="text-(length:--t-body) text-muted-foreground mt-1">
                      {lang === 'ar'
                        ? `وصول لـ ${(u.projectPermissions ?? []).filter((p) => p.canView).length} من ${projects.length} مشاريع`
                        : `Access to ${(u.projectPermissions ?? []).filter((p) => p.canView).length} of ${projects.length} projects`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {!isMe && u.username !== 'admin' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteUser(u.username); }}
                      className="p-1.5 text-white/20 hover:text-destructive transition-colors"
                      title={lang === 'ar' ? 'حذف المستخدم' : 'Delete user'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* Expanded: project permissions grid */}
              {isExpanded && (
                <div className="border-t border-white/10 p-5">
                  {u.role === 'admin' ? (
                    <div className="flex items-center gap-2 text-sm text-primary">
                      <KeyRound className="w-4 h-4" />
                      <span>
                        {lang === 'ar'
                          ? 'وصول كامل لجميع المشاريع — صلاحيات المدير'
                          : 'Full administrative access to all projects'}
                      </span>
                    </div>
                  ) : (
                    <>
                      <p className="text-(length:--t-label) uppercase tracking-widest text-muted-foreground mb-4">
                        {lang === 'ar' ? 'صلاحيات المشاريع' : 'Project Permissions'}
                      </p>

                      {/* Table header */}
                      <div className="grid grid-cols-[1fr_auto_auto] gap-3 mb-2 px-3">
                        <span className="text-(length:--t-label) uppercase text-muted-foreground">
                          {lang === 'ar' ? 'المشروع' : 'Project'}
                        </span>
                        <span className="text-(length:--t-label) uppercase text-muted-foreground w-20 text-center">
                          {lang === 'ar' ? 'عرض' : 'View'}
                        </span>
                        <span className="text-(length:--t-label) uppercase text-muted-foreground w-28 text-center">
                          {lang === 'ar' ? 'إدخال بيانات' : 'Data Entry'}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {projects.map((p) => {
                          const perm = getPermForProject(u.username, p.id);
                          return (
                            <div
                              key={p.id}
                              className={cn(
                                'grid grid-cols-[1fr_auto_auto] gap-3 items-center px-3 py-2.5 border transition-colors',
                                perm.canView
                                  ? 'border-primary/20 bg-primary/5'
                                  : 'border-white/5 bg-black/30'
                              )}
                            >
                              {/* project info */}
                              <div className="min-w-0">
                                <span className="font-mono text-(length:--t-data) text-muted-foreground block">{p.code}</span>
                                <span className="text-sm text-foreground truncate block">
                                  {lang === 'ar' ? p.nameAr : p.nameEn}
                                </span>
                              </div>

                              {/* View toggle */}
                              <button
                                onClick={() => toggleView(u.username, p.id)}
                                className={cn(
                                  'w-20 flex items-center justify-center gap-1.5 py-1.5 border text-xs font-medium transition-all',
                                  perm.canView
                                    ? 'bg-primary/20 border-primary/40 text-primary hover:bg-primary/10'
                                    : 'bg-transparent border-white/10 text-white/20 hover:border-white/20 hover:text-white/40'
                                )}
                              >
                                {perm.canView ? (
                                  <Eye className="w-3.5 h-3.5" />
                                ) : (
                                  <EyeOff className="w-3.5 h-3.5" />
                                )}
                                <span>{perm.canView ? (lang === 'ar' ? 'نعم' : 'On') : (lang === 'ar' ? 'لا' : 'Off')}</span>
                              </button>

                              {/* Edit toggle */}
                              <button
                                onClick={() => toggleEdit(u.username, p.id)}
                                disabled={!perm.canView}
                                className={cn(
                                  'w-28 flex items-center justify-center gap-1.5 py-1.5 border text-xs font-medium transition-all',
                                  !perm.canView
                                    ? 'opacity-30 cursor-not-allowed border-white/5 text-white/20'
                                    : perm.canEdit
                                    ? 'bg-chart-4/20 border-chart-4/40 text-chart-4 hover:bg-chart-4/10'
                                    : 'border-white/10 text-white/30 hover:border-white/20 hover:text-white/50'
                                )}
                              >
                                {perm.canEdit ? (
                                  <Pencil className="w-3.5 h-3.5" />
                                ) : (
                                  <PencilOff className="w-3.5 h-3.5" />
                                )}
                                <span>
                                  {perm.canEdit
                                    ? lang === 'ar' ? 'مفعّل' : 'Enabled'
                                    : lang === 'ar' ? 'للعرض فقط' : 'Read Only'}
                                </span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/*
        PHASE 3H — Danger Zone. Admin Console is the right home: it is
        already admin-gated and is where destructive administration
        belongs. The component renders nothing for a non-admin.
      */}
      {/*
        ACCESS CONTROL — Role + Scope + Module + Action + Time, with the
        audit trail and version history. Placed ABOVE the danger zone:
        it is everyday administration, not a destructive operation.
      */}
      <AccessControlPanel />

      <div className="mt-10">
        <CertificationDataset />
        {/* Storage-currency migration. Sits with the dataset controls
            because it is the same class of operation: it rewrites stored
            records, so it is admin-gated and dry-run first. */}
        <CurrencyMigrationPanel />
        <CashSyncRepairPanel />
        <EnterpriseReset />
      </div>
    </div>
  );
}
