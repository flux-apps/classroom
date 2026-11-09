import React from 'react';

export function RunningFooter({ page, pageWords, unit, align = 'left', style }) {
  const right = align === 'right';
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center',
      gap: '5pt', borderTop: 'var(--border-rule-0-5) solid var(--color-blue-4)', paddingTop: '2pt', ...style }}>
      <b style={{ color: 'var(--color-steel-blue)', fontFamily: 'var(--text-body-myriad-light-family)', fontSize: '11.5pt', fontWeight: 700 }}>{page}</b>
      <span style={{ width: 0, height: '10pt', borderLeft: 'var(--border-rule-0-5) solid var(--color-steel-blue)' }} />
      {pageWords ? <span style={{ fontFamily: 'var(--text-small-2-myriadpro-400-family)', fontSize: '10pt', color: 'var(--color-ink)' }}>{pageWords}</span> : null}
      {unit ? (
        <span style={{ position: 'absolute', [right ? 'right' : 'left']: '-22pt', bottom: '12pt', writingMode: 'vertical-rl',
          transform: right ? 'none' : 'rotate(180deg)', fontFamily: 'var(--text-small-2-myriadpro-400-family)', fontWeight: 700,
          fontSize: '8pt', letterSpacing: '0.06em', whiteSpace: 'nowrap', color: 'var(--color-lavender)' }}>{unit}</span>
      ) : null}
    </div>
  );
}
