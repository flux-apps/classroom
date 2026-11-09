import React from 'react';

export function GrammarBox({ title, tint = 'var(--color-green-tint)', accent = 'var(--color-grass-green)', children, style }) {
  return (
    <div style={{ boxSizing: 'border-box', padding: '10pt 16pt', background: tint, color: 'var(--color-ink)',
      fontFamily: 'var(--text-body-family)', fontSize: 'var(--text-body-size)', lineHeight: 'var(--space-spacing-baseline)', ...style }}>
      {title ? <div style={{ color: accent, fontWeight: 700, fontSize: 'var(--text-instruction-size)', marginBottom: '4pt' }}>{title}</div> : null}
      {children}
    </div>
  );
}
