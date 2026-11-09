import React from 'react';

export function GrammarTable({ columns, rows, accent = 'var(--color-grass-green)', width = '100%', style }) {
  const rule = 'var(--border-rule-0-5) solid color-mix(in srgb, var(--color-grey) 55%, white)';
  return (
    <table style={{ width, borderCollapse: 'collapse', fontFamily: 'var(--text-body-family)', fontSize: 'var(--text-body-size)',
      lineHeight: 'var(--space-spacing-baseline)', color: 'var(--color-ink)', ...style }}>
      <thead>
        <tr>{columns.map((c, i) => (
          <th key={i} style={{ background: accent, color: 'var(--color-paper)', textAlign: 'left', fontWeight: 700, padding: '1pt 6pt',
            borderLeft: i ? 'var(--border-rule-0-5) solid var(--color-paper)' : 'none' }}>{c}</th>
        ))}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>{r.map((c, ci) => (
            <td key={ci} style={{ padding: '1pt 6pt', borderBottom: rule, borderLeft: ci ? rule : 'none' }}>{c}</td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  );
}
