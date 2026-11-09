import React from 'react';

export function ExerciseHeading({ number, children, accent = 'var(--color-raspberry)', style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '9pt', color: accent,
      fontFamily: 'var(--text-heading-orange-family)', fontWeight: 700, fontSize: '12pt', lineHeight: '14pt', ...style }}>
      <span>{number}</span>
      <span>{children}</span>
    </div>
  );
}
