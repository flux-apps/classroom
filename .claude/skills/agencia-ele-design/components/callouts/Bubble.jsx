import React from 'react';

const TINTS = {
  sun: 'color-mix(in srgb, var(--color-yellow-3) 75%, white)',
  teal: 'var(--color-teal-tint)',
  rose: 'var(--color-red-tint)',
  lavender: 'color-mix(in srgb, var(--color-lavender) 55%, white)',
};

export function Bubble({ size = '90pt', tint = 'sun', children, style }) {
  return (
    <div style={{ width: size, height: size, boxSizing: 'border-box', flex: 'none', borderRadius: '50%', background: TINTS[tint] || tint,
      boxShadow: '0 1pt 4pt rgba(35,31,32,var(--opacity-0-35))', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 'calc(' + size + ' * 0.09)',
      fontFamily: 'var(--text-small-2-myriadpro-400-family)', fontSize: '10.5pt', lineHeight: '12.5pt', color: 'var(--color-ink)', ...style }}>
      <div>{children}</div>
    </div>
  );
}
