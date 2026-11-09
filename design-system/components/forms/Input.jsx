import React from 'react';
import { cx } from '../primitives/cx';
export function Input({ size = 'default', invalid, className, ...rest }) {
  return <input className={cx('ds-input', size === 'board' && 'ds-input--board', className)} aria-invalid={invalid || undefined} {...rest} />;
}
