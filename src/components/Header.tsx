import React from 'react';
import { GlobalSearch } from './GlobalSearch';
import { Bell } from 'lucide-react';

export default function Header() {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-white/[0.04] bg-black/8">
      <div className="flex items-center gap-4">
        <div className="text-white font-serif text-xl">PACTUM</div>
        {/* keep lightweight global search if available */}
        <div className="hidden md:block"><GlobalSearch /></div>
      </div>

      <div className="flex items-center gap-3">
        <button className="p-2 border border-white/[0.06] text-white/40 hover:text-primary"><Bell className="w-5 h-5" /></button>
        <div className="text-sm text-white/60 font-mono">Admin User</div>
      </div>
    </header>
  );
}
