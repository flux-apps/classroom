import React from 'react';

export function UnitTitleBar({ number, children, color = 'var(--color-teal-5)', style }) {
  return (
    <div style={{ position: 'relative', height: '19.8pt', display: 'flex', alignItems: 'center', ...style }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, background: color }} />
      <div style={{ position: 'relative', marginLeft: '2pt', marginTop: '-8pt', padding: '3pt 9pt 4pt', background: 'var(--color-paper)',
        transform: 'rotate(-3deg)', boxShadow: '0 1pt 3pt rgba(35,31,32,var(--opacity-0-35))', borderLeft: '3pt solid ' + color,
        fontFamily: 'var(--text-heading-orange-family)', fontWeight: 700, fontSize: '22pt', lineHeight: 1.05, whiteSpace: 'nowrap', color }}>
        <span style={{ color: 'color-mix(in srgb, ' + color + ' 55%, white)', marginRight: '6pt' }}>{number}</span>{children}
      </div>
    </div>
  );
}
