import React from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export default function SearchBar({ value, onChange, placeholder = 'Search companies...' }: Props) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search companies"
        className="bg-black/10 text-white placeholder:text-white/25 border border-white/[0.06] px-3 py-2 text-sm focus:outline-none focus:border-primary"
      />
    </div>
  );
}
