import React from 'react';

export function AudioIcon({ track, size = '17.9pt', style }) {
  const red = { fill: 'var(--color-red)' };
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: size, height: size,
      borderRadius: '50%', background: 'var(--color-red-tint)', color: 'var(--color-red)', ...style }}>
      <svg viewBox="0 0 12 9.5" width="10.5pt" height="8.2pt" aria-hidden="true">
        <rect x="0" y="2.5" width="3" height="4.5" style={red} />
        <polygon points="3,2.5 6.2,0 6.2,9.5 3,7" style={red} />
        <path d="M7.6 3 q1.6 1.75 0 3.5 M9 1.6 q3 3.15 0 6.3" fill="none" strokeWidth="0.9" style={{ stroke: 'var(--color-red-2)' }} />
      </svg>
      <span style={{ fontFamily: 'var(--text-small-2-myriadpro-400-family)', fontSize: '6.5pt', lineHeight: 1, marginTop: '0.5pt' }}>{track}</span>
    </span>
  );
}
