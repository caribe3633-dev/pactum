import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/store';
import { useLocation, Link, Redirect } from 'wouter';
import { Building2, ShieldAlert, LogOut, Globe, Search, Bell, TrendingUp, Rows3, HardHat, Archive } from 'lucide-react';

/** Display density. Only the type/spacing ladder changes; nothing else. */
type Density = 'compact' | 'comfortable' | 'executive';

const DENSITY_LABEL: Record<Density, { en: string; ar: string }> = {
  compact:     { en: 'Compact',     ar: 'مضغوط' },
  comfortable: { en: 'Comfortable', ar: 'مريح' },
  executive:   { en: 'Executive',   ar: 'تنفيذي' },
};
import { useTranslation } from '../lib/i18n';
import { cn } from '../lib/utils';
import PactumLogo from './PactumLogo';
import { GlobalSearch } from './GlobalSearch';
import { NotificationsPanel } from './NotificationsPanel';

/** Application home — Enterprise Portfolio */
const HOME = '/enterprise-portfolio';

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout, loading } = useAuth();
  const [location, setLocation] = useLocation();
  const { lang, setLang } = useTranslation();

  const handleLogout = () => { logout(); setLocation('/login'); };
  const toggleLang = () => setLang(lang === 'en' ? 'ar' : 'en');

  /**
   * Display density. Written to <html data-density> and remembered, so the
   * whole type scale shifts from one attribute — no component knows which
   * mode is active, which is what stops three densities becoming three
   * codebases.
   */
  const [density, setDensity] = useState<Density>(() => {
    try {
      const v = localStorage.getItem('pactum-density');
      return v === 'compact' || v === 'executive' ? v : 'comfortable';
    } catch { return 'comfortable'; }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
    try { localStorage.setItem('pactum-density', density); } catch { /* quota */ }
  }, [density]);

  const cycleDensity = () => {
    const order: Density[] = ['compact', 'comfortable', 'executive'];
    setDensity(order[(order.indexOf(density) + 1) % order.length]);
  };

  const [searchOpen, setSearchOpen] = useState(false);
  const [notifsOpen, setNotifsOpen] = useState(false);

  // Ctrl+K shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /**
   * ══════════════════════════════════════════════════════════════════════
   * NO SESSION → GO TO LOGIN. NEVER RENDER NOTHING.
   *
   * This was `if (!user) return null;` — and that single line was the
   * black screen after a Factory Reset.
   *
   * The reset correctly removes `pactum-auth`: wiping the session is the
   * point of a factory reset. But Shell wraps EVERY protected route, so
   * with no user it returned null and React mounted an empty tree. No
   * error was thrown, nothing was logged, and no redirect fired — the
   * app was working exactly as written, and the result was a black page
   * with no way out. A silent `return null` at a routing boundary is
   * indistinguishable from a crash.
   *
   * `loading` matters here. `useAuth` reads localStorage in an effect, so
   * `user` is null for the first render of a perfectly valid session.
   * Redirecting on that would throw a signed-in user back to the login
   * screen on every refresh, so the redirect waits until the read has
   * finished.
   *
   * NO BUSINESS DATA IS INVOLVED. Zero projects, zero sectors and zero
   * financial records are a valid first-class state; the only thing the
   * app genuinely cannot render without is a session.
   * ══════════════════════════════════════════════════════════════════════
   */
  if (loading) return null;
  if (!user) return <Redirect to="/login" />;

  /**
   * ══════════════════════════════════════════════════════════════════════
   * Company and Projects were REMOVED from the header.
   *
   * They duplicated the scope bar directly underneath, which already
   * carries a live Company / Sector / Project selector. Two navigation
   * systems for the same hierarchy, one above the other, is one too many:
   * the header links went to fixed index pages while the selector jumps
   * straight to the entity you name. The selector wins on both counts.
   *
   * ROUTES ARE UNTOUCHED. `/about` and `/portal` still exist and still
   * resolve — they simply are not advertised in the top bar any more.
   * ══════════════════════════════════════════════════════════════════════
   */
  const navItems = [
    { label: lang === 'ar' ? 'محفظة المشاريع' : 'Enterprise Portfolio', href: HOME, icon: TrendingUp },
    // Archive earns a top-level slot because work that vanishes with no
    // way back is the failure it exists to prevent. It sits next to the
    // portfolio, not inside Admin: archiving is routine project
    // housekeeping, not an administrative override.
    { label: lang === 'ar' ? 'الأرشيف' : 'Archive', href: '/archive', icon: Archive },
    ...(user.role === 'admin' ? [{ label: lang === 'ar' ? 'لوحة الإدارة' : 'Admin Console', href: '/admin', icon: ShieldAlert }] : []),
  ];

  const NavLinks = ({ compact = false }: { compact?: boolean }) => (
    <>
      {navItems.map((item) => {
        const active = location === item.href || location.startsWith(item.href + '/');
        return (
          <Link key={item.href} href={item.href}>
            <div
              role="menuitem"
              title={item.label}
              className={cn(
                'flex items-center gap-2.5 px-5 h-20 text-(length:--t-body) font-medium cursor-pointer transition-all border-b-2 whitespace-nowrap',
                active
                  ? 'text-primary border-primary bg-primary/[0.06]'
                  : 'text-white/50 border-transparent hover:text-white hover:bg-white/5'
              )}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              {!compact && <span>{item.label}</span>}
            </div>
          </Link>
        );
      })}
    </>
  );

  return (
    // `depth depth-app` carries the industrial atmosphere; every page inside
    // the Shell inherits it, so no screen ever styles its own background.
    <div className="flex h-dvh bg-background text-foreground overflow-hidden depth depth-app">
      {/* Atmosphere and brand mark. Decoration only: fixed, behind every
          surface, not selectable, hidden from assistive technology. */}
      <div className="depth-tooth" aria-hidden="true" />
      <div className="pactum-watermark" aria-hidden="true" />
      <div className="pactum-watermark-credit" aria-hidden="true">© Mohamed Mohsen</div>
      {/* ── Main content area (full width — sidebar removed) ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-0">
        {/* Desktop top strip — brand, nav, lang, user, logout */}
        <header className="hidden md:flex items-center px-6 h-20 border-b border-white/5 bg-black/40 flex-shrink-0 relative z-20 gap-1">
          {/* Brand — always navigates home (Enterprise Portfolio) */}
          <Link href={HOME}>
            <div className="flex items-center pe-5 me-3 border-e border-white/10 cursor-pointer flex-shrink-0">
              <PactumLogo variant="horizontal" size={44} title="PACTUM — Enterprise Portfolio" />
            </div>
          </Link>

          {/* Primary nav */}
          <nav className="flex items-center h-20 overflow-x-auto" aria-label={lang === 'ar' ? 'التنقل الرئيسي' : 'Main navigation'}>
            <NavLinks />
          </nav>

          {/* Right cluster */}
          <div className="flex items-center gap-2 ms-auto flex-shrink-0">
            <button
              onClick={() => setSearchOpen(true)}
              aria-label={lang === 'ar' ? 'بحث (Ctrl+K)' : 'Search (Ctrl+K)'}
              className="flex items-center gap-2 text-white/50 hover:text-white px-3 py-1.5 rounded-sm hover:bg-white/5 transition-colors border border-transparent hover:border-white/10 text-xs"
            >
              <Search className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="font-mono opacity-60">Ctrl+K</span>
            </button>

            <div className="w-px h-4 bg-white/10 mx-1" aria-hidden="true" />

            <button
              onClick={() => setNotifsOpen(true)}
              aria-label={lang === 'ar' ? 'الإشعارات' : 'Notifications'}
              className="relative text-white/50 hover:text-white p-2 hover:bg-white/5 transition-colors rounded-sm"
            >
              <Bell className="w-4 h-4" aria-hidden="true" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full border-2 border-black" aria-hidden="true" />
            </button>

            <button
              onClick={toggleLang}
              aria-label={lang === 'en' ? 'Switch to Arabic' : 'Switch to English'}
              className="text-white/50 hover:text-primary p-2 hover:bg-primary/5 transition-colors rounded-sm"
            >
              <Globe className="w-4 h-4" aria-hidden="true" />
            </button>

            {/* Display density — cycles compact / comfortable / executive */}
            <button
              onClick={cycleDensity}
              title={`${lang === 'ar' ? 'كثافة العرض' : 'Display density'}: ${lang === 'ar' ? DENSITY_LABEL[density].ar : DENSITY_LABEL[density].en}`}
              aria-label={lang === 'ar' ? 'كثافة العرض' : 'Display density'}
              className="flex items-center gap-1.5 text-white/50 hover:text-primary px-2 py-2 hover:bg-primary/5 transition-colors rounded-sm"
            >
              <Rows3 className="w-4 h-4" aria-hidden="true" />
              <span className="hidden xl:inline text-(length:--t-micro) uppercase tracking-wider">
                {lang === 'ar' ? DENSITY_LABEL[density].ar : DENSITY_LABEL[density].en}
              </span>
            </button>

            <div className="w-px h-4 bg-white/10 mx-1" aria-hidden="true" />

            {/* User + logout */}
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-bold font-mono text-xs flex-shrink-0"
                aria-hidden="true"
              >
                {user.username[0].toUpperCase()}
              </div>
              <div className="hidden lg:block min-w-0 max-w-[9rem]">
                <p className="text-xs font-medium text-white truncate leading-none">{user.username}</p>
                <p className="text-(length:--t-label) uppercase text-white/45 tracking-wider mt-0.5">{user.role}</p>
              </div>
              <button
                onClick={handleLogout}
                aria-label={lang === 'ar' ? 'تسجيل الخروج' : 'Log out'}
                className="text-white/30 hover:text-red-400 transition-colors p-1.5 hover:bg-red-400/5 rounded-sm"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        {/* Mobile top bar */}
        <header className="md:hidden flex flex-col bg-black/60 border-b border-white/10 flex-shrink-0 relative z-20">
          <div className="flex items-center justify-between px-4 h-14">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSearchOpen(true)}
                aria-label={lang === 'ar' ? 'بحث' : 'Search'}
                className="text-white/60 hover:text-white p-1"
              >
                <Search className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            {/* Brand — always navigates home */}
            <Link href={HOME}>
              <div className="flex items-center absolute left-1/2 -translate-x-1/2 cursor-pointer">
                <PactumLogo variant="horizontal" size={26} title="PACTUM" />
              </div>
            </Link>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setNotifsOpen(true)}
                aria-label={lang === 'ar' ? 'الإشعارات' : 'Notifications'}
                className="relative text-white/60 hover:text-white p-1"
              >
                <Bell className="w-4 h-4" aria-hidden="true" />
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-primary rounded-full" aria-hidden="true" />
              </button>
              <button
                onClick={toggleLang}
                aria-label={lang === 'en' ? 'Switch to Arabic' : 'Switch to English'}
                className="text-white/40 hover:text-primary text-xs font-medium px-1"
              >
                {lang === 'en' ? 'ع' : 'EN'}
              </button>
              <button
                onClick={handleLogout}
                aria-label={lang === 'ar' ? 'تسجيل الخروج' : 'Log out'}
                className="text-white/40 hover:text-red-400 p-1"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Mobile horizontal nav strip */}
          <nav className="flex items-center h-12 px-2 overflow-x-auto border-t border-white/5" aria-label={lang === 'ar' ? 'التنقل الرئيسي' : 'Main navigation'}>
            <NavLinks />
          </nav>
        </header>

        <main className="flex-1 overflow-auto relative" id="main-content">
          {/* Dot-grid texture */}
          <div
            className="absolute inset-0 opacity-[0.012] pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}
            aria-hidden="true"
          />
          {children}
        </main>
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <NotificationsPanel open={notifsOpen} onClose={() => setNotifsOpen(false)} />
    </div>
  );
}
