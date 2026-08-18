import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useAuth, useUsers } from '../lib/store';
import { useTranslation } from '../lib/i18n';
import { INITIAL_USERS } from '../lib/data';
import PactumLogo from '../components/PactumLogo';
import { User, Lock, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';

// ─── Workspace initialisation steps ────────────────────────────────────
// Shown after credentials are accepted, never before.
const AUTH_MESSAGES_EN = [
  'Verifying credentials',
  'Initialising workspace',
  'Loading contracts & projects',
  'Preparing executive dashboard',
];
const AUTH_MESSAGES_AR = [
  'التحقق من بيانات الدخول',
  'تهيئة مساحة العمل',
  'تحميل العقود والمشاريع',
  'إعداد لوحة التحكم التنفيذية',
];

export default function LoginPage() {
  // ── Auth state (UNCHANGED) ───────────────────────────────────────────
  const [username,    setUsername]    = useState('');
  const [password,    setPassword]    = useState('');
  const [rememberMe,  setRememberMe]  = useState(false);
  const [error,       setError]       = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [, setLocation]         = useLocation();
  const { login }               = useAuth();
  const { users }               = useUsers();
  const { t, lang, setLang }    = useTranslation();
  const isAr                    = lang === 'ar';

  // ── UI-only additions ────────────────────────────────────────────────
  const [showPwd,       setShowPwd]       = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [authMsg,        setAuthMsg]        = useState('');
  const [authProgress,   setAuthProgress]   = useState(0);
  const [msgKey,         setMsgKey]         = useState(0); // triggers fade on message change
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Post-auth overlay cycle (UI only — navigate after messages) ───────
  useEffect(() => {
    if (!authenticating) return;
    const msgs = isAr ? AUTH_MESSAGES_AR : AUTH_MESSAGES_EN;
    setAuthMsg(msgs[0]);
    setMsgKey(0);
    setAuthProgress(0);
    // Start progress bar animation
    const pt = setTimeout(() => setAuthProgress(100), 60);
    // Cycle through messages, then navigate
    let i = 0;
    intervalRef.current = setInterval(() => {
      i += 1;
      if (i < msgs.length) {
        setAuthMsg(msgs[i]);
        setMsgKey(i);
      } else {
        if (intervalRef.current) clearInterval(intervalRef.current);
      // After authentication, navigate to Enterprise Portfolio (root)
      setLocation('/');
      }
    }, 360);
    return () => {
      clearTimeout(pt);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [authenticating]); // eslint-disable-line

  // ── handleLogin — logic IDENTICAL to original ──────────────────────
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(false);
    setTimeout(() => {
      const allUsers = users.length > 0 ? users : INITIAL_USERS;
      const matched = allUsers.find(
        (u) => u.username === username &&
          (u.password === password || (!u.password && password === (username === 'admin' ? '123456789' : 'viewer123')))
      );
      if (matched || (username === 'admin' && password === '123456789') || (username === 'viewer' && password === 'viewer123')) {
        login(matched || INITIAL_USERS.find((u) => u.username === username)!);
        setLoading(false);
        setAuthenticating(true); // ← show loading overlay, navigate inside useEffect
      } else {
        setError(true);
        setLoading(false);
      }
    }, 600);
  };

  // ────────────────────────────────────────────────────────────────────
  // SPLASH — workspace initialisation, after authentication
  // ────────────────────────────────────────────────────────────────────
  if (authenticating) {
    const msgs = isAr ? AUTH_MESSAGES_AR : AUTH_MESSAGES_EN;
    return (
      <div
        className="fixed inset-0 z-50 depth stage"
        aria-live="polite"
        aria-label={isAr ? 'جارٍ تحميل المنصة' : 'Loading platform'}
      >
        <div className="depth-tooth" aria-hidden="true" />
        <div className="pactum-watermark" aria-hidden="true" />

        <div className="stage-inner ds-page">
          <PactumLogo variant="primary" size={62} className="brand-lockup brand-lockup-lg" title="PACTUM" />

          {/* Initialisation checklist — the same four steps, as a sequence. */}
          <div className="init-steps">
            {msgs.map((m, i) => (
              <div
                key={m}
                className={`init-step${i < msgKey ? ' done' : i === msgKey ? ' on' : ''}`}
              >
                <i aria-hidden="true" />
                {m}
              </div>
            ))}
          </div>

          {/* Progress — driven by authProgress exactly as before. */}
          <div className="stage-progress" role="progressbar" aria-valuenow={authProgress}>
            <i style={{ width: authProgress + '%', animation: 'none' }} />
          </div>

          <div key={msgKey} className="stage-caption ds-page">{authMsg}</div>
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // LOGIN
  // ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-dvh w-full depth stage" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="depth-tooth" aria-hidden="true" />
      <div className="pactum-watermark" aria-hidden="true" />
      <div className="pactum-watermark-credit" aria-hidden="true">© Mohamed Mohsen</div>

      {/* Language toggle */}
      <button
        onClick={() => setLang(isAr ? 'en' : 'ar')}
        className="btn btn-ghost btn-sm absolute top-6 end-6 z-20"
        aria-label={isAr ? 'Switch to English' : 'التبديل إلى العربية'}
      >
        {isAr ? 'English' : 'العربية'}
      </button>

      <div className="stage-inner ds-page stage-col">

        {/* Brand lockup — the same mark the header carries. */}
        <PactumLogo variant="primary" size={62} className="brand-lockup" title="PACTUM" />

        {/* Access card — tier 4, the executive surface. */}
        <form onSubmit={handleLogin} noValidate className="ds-card ds-card-exec w-full text-start mt-8">

          <div className="flex items-start gap-3 !mt-0">
            <div className="p-2 border border-primary/25 bg-primary/[0.07] shrink-0">
              <ShieldCheck className="w-4 h-4 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h2 className="t-card">{isAr ? 'الوصول التنفيذي' : 'Executive Access'}</h2>
              <p className="t-second !mt-1">
                {isAr
                  ? 'أدخل بيانات الاعتماد للوصول إلى مساحة العمل المؤمّنة'
                  : 'Authenticate to access your secure workspace'}
              </p>
            </div>
          </div>

          {/* Username */}
          <div className="field">
            <label className="field-label" data-required htmlFor="pactum-username">{t.username}</label>
            <div className="relative">
              <User
                className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-white/25 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="pactum-username"
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(false); }}
                dir="ltr"
                className="field-input font-mono ps-10"
                placeholder={isAr ? 'اسم_المستخدم' : 'username'}
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={error || undefined}
              />
            </div>
          </div>

          {/* Password */}
          <div className="field">
            <label className="field-label" data-required htmlFor="pactum-password">{t.password}</label>
            <div className="relative">
              <Lock
                className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-white/25 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="pactum-password"
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(false); }}
                dir="ltr"
                className="field-input font-mono ps-10 pe-10"
                placeholder="••••••••••"
                required
                autoComplete="current-password"
                aria-invalid={error || undefined}
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                className="absolute top-1/2 -translate-y-1/2 end-2 p-1.5 text-white/25 hover:text-white/60 transition-colors"
                aria-label={showPwd ? 'Hide password' : 'Show password'}
              >
                {showPwd
                  ? <EyeOff className="w-4 h-4" aria-hidden="true" />
                  : <Eye    className="w-4 h-4" aria-hidden="true" />}
              </button>
            </div>
          </div>

          {/* Remember me */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="checkbox"
              aria-checked={rememberMe}
              onClick={() => setRememberMe(v => !v)}
              className="relative flex-shrink-0 w-4 h-4 transition-colors"
              style={{
                border: `1px solid ${rememberMe ? 'rgba(212,175,55,0.7)' : 'rgba(255,255,255,0.15)'}`,
                background: rememberMe ? 'rgba(212,175,55,0.15)' : 'transparent',
              }}
              aria-label={isAr ? 'تذكّرني' : 'Remember me'}
            >
              {rememberMe && (
                <svg className="absolute inset-0 m-auto w-2.5 h-2.5" viewBox="0 0 10 8" fill="none" aria-hidden="true">
                  <polyline points="1,4 3.8,7 9,1" stroke="#d4af37" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <span
              className="t-second cursor-pointer select-none hover:text-white/60 transition-colors"
              onClick={() => setRememberMe(v => !v)}
            >
              {isAr ? 'تذكّرني' : 'Remember me'}
            </span>
          </div>

          {/* Error */}
          {error && (
            <div className="badge badge-risk !w-full !justify-start !py-2.5 !px-3 !rounded-none" role="alert">
              {isAr ? 'اسم المستخدم أو كلمة المرور غير صحيحة' : 'Invalid username or password. Please try again.'}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn btn-primary w-full">
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                {isAr ? 'جارٍ التحقق…' : 'Authenticating…'}
              </>
            ) : (
              isAr ? 'دخول المنصة' : 'Enter Workspace'
            )}
          </button>

          {/* Card footer */}
          <div className="pt-4 border-t border-white/[0.06] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 opacity-40">
              <PactumLogo variant="icon" size={14} />
              <span className="t-second !text-(length:--t-label) tracking-widest uppercase font-mono">
                PACTUM Enterprise
              </span>
            </div>
            <div className="t-second !text-(length:--t-data) font-mono opacity-30">v 1.0 · © 2026</div>
          </div>
        </form>

        <p className="stage-caption">
          {isAr ? 'الوصول مقيّد — موظفون مرخّصون فقط' : 'Restricted Access — Authorized Personnel Only'}
        </p>
      </div>
    </div>
  );
}
