import React from 'react';

interface Props { children: React.ReactNode; title?: string; fullWidth?: boolean }

export default function PageContainer({ children, title, fullWidth }: Props) {
  return (
    <div className="w-full">
      {title && <h2 className="font-serif text-2xl text-white mb-2">{title}</h2>}
      <div className="bg-black/10 border border-white/[0.04] p-4">
        {children}
      </div>
    </div>
  );
}


