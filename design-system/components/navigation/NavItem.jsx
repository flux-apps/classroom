import React from 'react';
import { cx, accentClass } from '../primitives/cx';
import { Icon } from '../primitives/Icon';
export function NavItem({ icon, label, current, accent, className, ...rest }) {
  return (
    <button type="button" className={cx('ds-nav', accentClass(accent), className)} aria-current={current ? 'page' : undefined} {...rest}>
      <Icon name={icon} size={22} /><span className="ds-nav__label">{label}</span>
    </button>
  );
}
