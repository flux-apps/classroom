import React from 'react';

const TONES = {
  rose: { bg: 'var(--color-red-tint)', ink: 'var(--color-magenta)', font: 'var(--text-note-hand-magenta-family)' },
  sun: { bg: 'var(--color-yellow-3)', ink: 'var(--color-ink)', font: 'var(--text-note-hand-magenta-family)' },
  teal: { bg: 'var(--color-teal-tint)', ink: 'var(--color-example-blue)', font: 'var(--text-note-hand-blue-family)' },
};

export function StickyNote({ tone = 'sun', tilt = -3, children, width = '200pt', style }) {
  const t = TONES[tone] || TONES.sun;
  return (
    <div style={{ width, boxSizing: 'border-box', padding: '9pt 12pt', background: t.bg, color: t.ink, fontFamily: t.font,
      fontSize: '11pt', lineHeight: 'var(--space-spacing-baseline)', borderRadius: 'var(--radius-3)', transform: 'rotate(' + tilt + 'deg)',
      boxShadow: '0 1pt 3pt rgba(35,31,32,var(--opacity-0-35))', ...style }}>{children}</div>
  );
}
