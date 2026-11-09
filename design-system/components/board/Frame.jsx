import React from 'react';
import { cx } from '../primitives/cx';
export function Frame({ title, width, height, className, children }) {
  return <div className={cx('ds-frame', className)} style={{ width, height }}><span className="ds-frame__title">{title}</span>{children}</div>;
}
