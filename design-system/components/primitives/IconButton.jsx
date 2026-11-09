import React from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
export function IconButton({ icon, label, pressed, size = 'default', className, ...rest }) {
  return (
    <button type="button" aria-label={label} aria-pressed={pressed} className={cx('ds-iconbtn', size === 'board' && 'ds-iconbtn--board', className)} {...rest}>
      <Icon name={icon} size={size === 'board' ? 32 : 22} />
    </button>
  );
}
