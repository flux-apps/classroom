import React from 'react';

export function NumberTag({ n, ring = 'var(--color-magenta-3)', style }) {
  return (
    <span style={{ display: 'inline-grid', placeItems: 'center', width: '14.2pt', height: '14.2pt', borderRadius: '50%',
      background: 'var(--color-paper)', boxShadow: '0 0 0 1pt ' + ring + ', 0 1pt 3pt rgba(35,31,32,var(--opacity-0-35))',
      color: 'var(--color-ink)', fontFamily: 'var(--text-heading-orange-family)', fontWeight: 700, fontSize: '10pt', lineHeight: 1, ...style }}>{n}</span>
  );
}
