import React from 'react';
import { cx, accentClass } from '../primitives/cx';
import { Icon } from '../primitives/Icon';
export function AddSlot({ children, accent, board, className, ...rest }) {
  return <button type="button" className={cx('ds-addslot', board && 'ds-addslot--board', accentClass(accent), className)} {...rest}><Icon name="plus" size={20} />{children}</button>;
}
