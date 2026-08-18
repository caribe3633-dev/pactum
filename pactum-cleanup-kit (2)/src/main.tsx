import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { LanguageProvider } from './lib/i18n';
import './index.css';

/**
 * ══════════════════════════════════════════════════════════════════════
 * THE LANGUAGE PROVIDER WAS NEVER MOUNTED.
 *
 * `LanguageProvider` existed in i18n.ts and was exported — and nothing
 * rendered it. Every `useTranslation()` call therefore fell through to
 * the context-less fallback:
 *
 *     return { lang, setLang: (_: Language) => {}, t: T[lang] };
 *                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *
 * `setLang` was a NO-OP. The globe button called it on every click, the
 * click registered, and nothing happened — no direction change, no
 * stored preference, no re-render. Measured before the fix: clicked
 * true, `documentElement.dir` still empty, `pactum-lang` still null.
 *
 * Mounting the provider here fixes the button, the RTL flip and the
 * persistence in one place, because all three were already implemented
 * and simply unreachable.
 * ══════════════════════════════════════════════════════════════════════
 */
createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <App />
  </LanguageProvider>
);
