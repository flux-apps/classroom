import React from 'react';
import { cx, accentClass, ACCENT_SHAPE } from './cx';
export function Marker({ accent, shape, large, className }) {
  return <span aria-hidden="true" className={cx('ds-mark', 'ds-mark--' + (shape || ACCENT_SHAPE[accent] || 'circle'), large && 'ds-mark--lg', accentClass(accent), className)} />;
}
