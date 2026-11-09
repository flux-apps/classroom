import React from 'react';
import { cx } from '../primitives/cx';
export function StickyNote({ color = 'yellow', flat, className, children }) {
  return <div className={cx('ds-sticky', color !== 'yellow' && 'ds-sticky--' + color, flat && 'ds-sticky--flat', className)}>{children}</div>;
}
