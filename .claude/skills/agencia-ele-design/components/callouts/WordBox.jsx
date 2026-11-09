import React from 'react';

export function WordBox({ items, color = 'var(--color-lime)', width = '100%', style }) {
  return (
    <div style={{ width, boxSizing: 'border-box', padding: '9pt 14pt', border: 'var(--border-rule-1) solid ' + color, borderRadius: 'var(--radius-12)',
      textAlign: 'center', color: 'var(--color-slate)', fontFamily: 'var(--text-body-family)', fontSize: '10pt', lineHeight: 'var(--space-spacing-baseline)', ...style }}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span style={{ color: 'var(--color-ink)', margin: '0 4pt' }}>{'\u2022'}</span> : null}
          <span>{it}</span>
        </React.Fragment>
      ))}
    </div>
  );
}
