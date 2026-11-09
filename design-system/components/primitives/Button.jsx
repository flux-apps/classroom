import React from 'react';
import { cx, accentClass } from './cx';
import { Icon } from './Icon';
export function Button({ variant = 'primary', size = 'default', icon, accent, className, children, ...rest }) {
  return (
    <button type="button" className={cx('ds-btn', variant !== 'primary' && 'ds-btn--' + variant, size !== 'default' && 'ds-btn--' + size, accentClass(accent), className)} {...rest}>
      {icon && <Icon name={icon} size={20} />}
      {children}
    </button>
  );
}
