import React from 'react';
import ContextBar from '../components/ContextBar';

export default function PlaceholderPage({ params, title = 'Placeholder' }: any) {
  const id = params?.id || '';
  return (
    <div className="min-h-full w-full bg-background">
      <ContextBar items={[{ label: 'Enterprise' }, { label: id ? `${title} ${id}` : title }]} />
      <div className="pg pg-stack">
        <div className="pg-head"><h1 className="pg-title">{title}</h1></div>
        <div className="ds-card ds-card-flat">
          <p className="ds-empty-sub">{title} is not implemented yet.</p>
        </div>
      </div>
    </div>
  );
}
