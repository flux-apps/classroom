import React from 'react';
import { cx } from './cx';
export function Icon({ name, size = 24, className, style }) {
  return <span aria-hidden="true" className={cx('ic', 'ic-' + name, 'ds-icon', className)} style={{ '--icon-size': size + 'px', ...style }} />;
}
