import React from 'react';
import { cx, accentClass } from './cx';
export function Badge({ tone: toneProp, accent, className, children }) {
  const tone = toneProp || (accent ? 'accent' : 'neutral');
  return <span className={cx('ds-badge', tone !== 'neutral' && 'ds-badge--' + tone, accentClass(accent), className)}>{children}</span>;
}
