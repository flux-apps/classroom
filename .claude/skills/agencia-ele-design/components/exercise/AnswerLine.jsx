import React from 'react';

export function AnswerLine({ width = '112pt', variant = 'solid', children, style }) {
  const dotted = variant === 'dotted';
  return (
    <span style={{ display: 'inline-block', minWidth: width, textAlign: 'center', verticalAlign: 'baseline',
      borderBottom: dotted ? 'var(--border-rule-0-5) dotted var(--color-ink)' : 'var(--border-rule-1) solid var(--color-grey)', ...style }}>
      {children || '\u00a0'}
    </span>
  );
}
