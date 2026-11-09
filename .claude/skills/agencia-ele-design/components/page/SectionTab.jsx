import React from 'react';

export function SectionTab({ side = 'left', color = 'var(--color-lime)', children, style }) {
  const left = side === 'left';
  return (
    <div style={{ width: '51.5pt', height: '151.2pt', filter: 'drop-shadow(0 1pt 2pt rgba(35,31,32,var(--opacity-0-45)))', ...style }}>
      <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box', background: color, color: 'var(--color-paper)',
        clipPath: left ? 'polygon(0 0,100% 0,100% 100%,0 94%)' : 'polygon(0 0,100% 0,100% 94%,0 100%)',
        writingMode: 'vertical-rl', transform: left ? 'rotate(180deg)' : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: '12pt 0 0 0',
        fontFamily: 'var(--text-heading-orange-family)', fontWeight: 700, fontSize: '17pt', lineHeight: 1, whiteSpace: 'nowrap',
      }}>{children}</div>
    </div>
  );
}
