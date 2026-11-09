import React from 'react';

export function NotebookCard({ children, width = '355pt', style }) {
  return (
    <div style={{ width, boxSizing: 'border-box', padding: '10pt 14pt 6pt', background: 'color-mix(in srgb, var(--color-teal-tint) 35%, white)', backgroundOrigin: 'content-box', backgroundClip: 'border-box', borderRadius: 'var(--radius-3)',
      boxShadow: '0 1.5pt 4pt rgba(35,31,32,var(--opacity-0-45))', border: 'var(--border-rule-0-25) solid var(--color-lavender)',
      backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--space-spacing-baseline) * 1.25 - 0.3pt), var(--color-lavender) calc(var(--space-spacing-baseline) * 1.25 - 0.3pt), var(--color-lavender) calc(var(--space-spacing-baseline) * 1.25))',
      color: 'var(--color-example-blue)', fontFamily: 'var(--text-note-hand-blue-family)', fontSize: '13pt', lineHeight: 'calc(var(--space-spacing-baseline) * 1.25)', ...style }}>
      {children}
    </div>
  );
}
