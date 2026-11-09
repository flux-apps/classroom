import React from 'react';
import { cx } from '../primitives/cx';
import { Icon } from '../primitives/Icon';
export function Toast({ tone = 'neutral', icon, className, children }) {
  return <div role="status" className={cx('ds-toast', tone !== 'neutral' && 'ds-toast--' + tone, className)}>{icon && <Icon name={icon} size={20} />}{children}</div>;
}
