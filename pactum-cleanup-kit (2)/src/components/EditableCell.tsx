import React, { useState, useRef, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import { toInputDate, formatDate } from '../lib/dateFormat';

interface EditableNumberProps {
  value: number;
  onSave: (v: number) => void;
  className?: string;
  canEdit?: boolean;
  prefix?: string;
  suffix?: string;
  display?: string; // pre-formatted display string
}

export function EditableNumber({ value, onSave, className = '', canEdit = true, display, suffix }: EditableNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    const num = parseFloat(draft.replace(/,/g, ''));
    if (!isNaN(num)) onSave(num);
    setEditing(false);
  };

  if (!canEdit) return <span className={className}>{display ?? value}</span>;

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="bg-primary/10 border border-primary/50 px-2 py-0.5 font-mono text-sm w-full focus:outline-none text-white number-ltr"
        dir="ltr"
        style={{ minWidth: 100 }}
      />
    );
  }

  return (
    <span
      className={`${className} group relative cursor-pointer hover:text-primary transition-colors`}
      onClick={() => { setDraft(String(value)); setEditing(true); }}
      title="Click to edit"
    >
      {display ?? value}{suffix}
      <Pencil className="w-2.5 h-2.5 inline ml-1 opacity-0 group-hover:opacity-40 transition-opacity" />
    </span>
  );
}

interface EditableDateProps {
  value: string; // stored as YYYY-MM-DD or DD/MM/YYYY
  onSave: (v: string) => void;
  canEdit?: boolean;
  className?: string;
  /** Shown when the date is empty. An empty cell has nothing to click. */
  placeholder?: string;
}

export function EditableDate({ value, onSave, canEdit = true, className = '', placeholder = 'Set date' }: EditableDateProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(toInputDate(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    if (draft) {
      // Store as DD/MM/YYYY
      const [yyyy, mm, dd] = draft.split('-');
      onSave(`${dd}/${mm}/${yyyy}`);
    }
    setEditing(false);
  };

  if (!canEdit) return <span className={className}>{formatDate(value) || '—'}</span>;

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="bg-primary/10 border border-primary/50 px-2 py-0.5 font-mono text-sm focus:outline-none text-white"
        style={{ colorScheme: 'dark' }}
      />
    );
  }

  return (
    <span
      className={`${className} group cursor-pointer hover:text-primary transition-colors`}
      onClick={() => { setDraft(toInputDate(value)); setEditing(true); }}
      title="Click to edit"
    >
      {/* An empty date must still be clickable, otherwise a generated row
          (change order / claim) can never be given its dates. */}
      {formatDate(value) || <span className="italic text-white/25">{placeholder}</span>}
      <Pencil className="w-2.5 h-2.5 inline ml-1 opacity-0 group-hover:opacity-40 transition-opacity" />
    </span>
  );
}

interface EditableTextProps {
  value: string;
  onSave: (v: string) => void;
  canEdit?: boolean;
  className?: string;
  placeholder?: string;
}

export function EditableText({ value, onSave, canEdit = true, className = '', placeholder }: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => { if (draft.trim()) onSave(draft.trim()); setEditing(false); };

  if (!canEdit) return <span className={className}>{value}</span>;

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="bg-primary/10 border border-primary/50 px-2 py-0.5 text-sm w-full focus:outline-none text-white"
        placeholder={placeholder}
      />
    );
  }

  return (
    <span
      className={`${className} group cursor-pointer hover:text-primary transition-colors`}
      onClick={() => { setDraft(value); setEditing(true); }}
      title="Click to edit"
    >
      {value || <span className="italic text-white/20">{placeholder}</span>}
      <Pencil className="w-2.5 h-2.5 inline ml-1 opacity-0 group-hover:opacity-40 transition-opacity" />
    </span>
  );
}

interface EditableSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onSave: (v: string) => void;
  canEdit?: boolean;
  className?: string;
}

export function EditableSelect({ value, options, onSave, canEdit = true, className = '' }: EditableSelectProps) {
  if (!canEdit) {
    const label = options.find((o) => o.value === value)?.label ?? value;
    return <span className={className}>{label}</span>;
  }
  return (
    <select
      value={value}
      onChange={(e) => onSave(e.target.value)}
      className={`bg-black/60 border border-white/10 px-2 py-1 text-sm focus:outline-none focus:border-primary text-white ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
